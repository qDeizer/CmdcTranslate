// Paid, read-only probe: saved model/account; no prompt, arguments or identities in evidence.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';

const baseline = process.argv.includes('--baseline');
const { makeServer } = await import(baseline ? '../evidence/private/stream-baseline/src/server.mjs' : '../src/server.mjs');
const profile = JSON.parse(await readFile(new URL('../config.local.json', import.meta.url)));
const muse = process.argv.includes('--muse');
if (muse) for (const model of Object.values(profile.models)) {
  model.upstreamModel = 'meta/muse-spark-1.3-contributor';
  model.efforts = ['low', 'medium', 'high', 'xhigh'];
  model.effortMap = { default: 'low', none: 'omit', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };
}
const credentials = JSON.parse(await readFile(new URL('../.astra-secrets.json', import.meta.url)));
const report = { date: new Date().toISOString(), revision: baseline ? '6d7069b' : 'working-tree', cases: [] };
let active;
const previous = new Map();
const hash = s => createHash('sha256').update(s).digest('hex');
const pieces = () => ({ text: [], tool: [], reasoning: [] });
const stamp = (where, kind, text) => { if (text) where[kind].push({ ms: Date.now() - active.started, chars: text.length, hash: hash(text) }); };
function lines(callback) {
  const decoder = new StringDecoder('utf8'); let pending = '';
  return bytes => {
    pending += decoder.write(Buffer.from(bytes)); let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
      if (line) callback(line);
    }
  };
}
const original = https.request;
https.request = function (...args) {
  const req = original.apply(this, args);
  if (String(args[0]) !== profile.upstream.baseUrl + profile.upstream.path) return req;
  const row = active, headers = args[1].headers, trace = headers.traceparent?.split('-');
  const last = previous.get(row.protocol);
  row.sameSession = last ? last.session === headers['x-session-id'] : null;
  row.sameTrace = last ? last.trace === trace?.[1] : null;
  row.newSpan = last ? last.span !== trace?.[2] : null;
  const end = req.end;
  req.end = function (data, ...rest) {
    const body = JSON.parse(String(data));
    row.sameThread = last ? last.thread === body.threadId : null;
    row.model = body.params.model; row.effort = body.params.reasoning_effort ?? null;
    previous.set(row.protocol, { session: headers['x-session-id'], thread: body.threadId, trace: trace?.[1], span: trace?.[2] });
    return end.call(this, data, ...rest);
  };
  req.once('response', res => {
    row.upstreamHeadersMs = Date.now() - row.started;
    const parse = lines(line => {
      const e = JSON.parse(line);
      if (e.type === 'text-delta') stamp(row.native, 'text', e.text);
      if (e.type === 'reasoning-delta') stamp(row.native, 'reasoning', e.text);
      if (e.type === 'tool-input-delta') stamp(row.native, 'tool', e.delta);
      if (e.type === 'tool-call') row.validatedToolMs = Date.now() - row.started;
      if (e.type === 'finish') row.nativeFinishMs = Date.now() - row.started;
    });
    const emit = res.emit;
    res.emit = function (event, ...values) { if (event === 'data') parse(values[0]); return emit.call(this, event, ...values); };
  });
  return req;
};
const server = makeServer(profile, credentials, { logger: r => { if (r.metrics) active.metrics = r.metrics; } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const prompt = 'Call report_text once with a text argument containing 20 numbered sentences about growing tomatoes, about 400 words. Do not write a normal response. This is a streaming transport test.';
try {
  for (const protocol of ['anthropic', 'responses']) {
    const setting = profile.clients[protocol === 'anthropic' ? 'claude' : 'codex'];
    const common = { model: setting.model, stream: true };
    const first = protocol === 'anthropic' ? { ...common, max_tokens: 2048, output_config: { effort: setting.effort },
      messages: [{ role: 'user', content: prompt }], tools: [{ name: 'report_text', input_schema: schema }] }
      : { ...common, max_output_tokens: 2048, reasoning: { effort: setting.effort },
        input: prompt, tools: [{ type: 'function', name: 'report_text', parameters: schema }] };
    const hint = randomUUID();
    let body = first;
    for (let turn = 0; turn < 2; turn++) {
      active = { protocol, turn, started: Date.now(), native: pieces(), downstream: pieces() };
      const res = await fetch(base + (protocol === 'anthropic' ? '/v1/messages' : '/v1/responses'), {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + credentials.gatewayToken,
          'x-astra-conversation-id': hint }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
      });
      active.status = res.status; active.downstreamHeadersMs = Date.now() - active.started;
      const events = [];
      const parse = lines(line => {
        if (!line.startsWith('data: ')) return;
        const e = JSON.parse(line.slice(6)); events.push(e);
        if (e.delta?.type === 'text_delta') stamp(active.downstream, 'text', e.delta.text);
        if (e.delta?.type === 'thinking_delta') stamp(active.downstream, 'reasoning', e.delta.thinking);
        if (e.delta?.type === 'input_json_delta') stamp(active.downstream, 'tool', e.delta.partial_json);
        if (e.type === 'response.output_text.delta') stamp(active.downstream, 'text', e.delta);
        if (e.type === 'response.reasoning_summary_text.delta') stamp(active.downstream, 'reasoning', e.delta);
        if (e.type === 'response.function_call_arguments.delta') stamp(active.downstream, 'tool', e.delta);
      });
      for await (const chunk of res.body) parse(chunk);
      active.durationMs = Date.now() - active.started;
      active.terminal = events.at(-1)?.type;
      active.channels = Object.fromEntries(['text', 'tool', 'reasoning'].map(kind => {
        const n = active.native[kind], d = active.downstream[kind];
        const exact = n.length === d.length && n.every((p, i) => p.hash === d[i].hash);
        return [kind, { nativeDeltas: n.length, downstreamDeltas: d.length, exactPieces: exact,
          firstNativeMs: n[0]?.ms ?? null, firstDownstreamMs: d[0]?.ms ?? null,
          nativeSpanMs: n.length ? n.at(-1).ms - n[0].ms : null,
          downstreamSpanMs: d.length ? d.at(-1).ms - d[0].ms : null,
          maxRelayMs: exact && n.length ? Math.max(...d.map((p, i) => p.ms - n[i].ms)) : null }];
      }));
      active.toolPreviewBeforeValidation = active.downstream.tool.length > 0 && active.downstream.tool[0].ms < active.validatedToolMs;
      active.passed = res.status === 200 && active.terminal === (protocol === 'anthropic' ? 'message_stop' : 'response.completed')
        && (baseline || Object.values(active.channels).every(c => c.exactPieces));
      if (turn) active.passed &&= active.sameSession && active.sameThread && active.sameTrace && active.newSpan;
      if (!turn) {
        const call = protocol === 'anthropic' ? events.find(e => e.content_block?.type === 'tool_use')?.content_block
          : events.find(e => e.type === 'response.output_item.done' && e.item.type === 'function_call')?.item;
        const raw = protocol === 'anthropic' ? events.filter(e => e.delta?.type === 'input_json_delta').map(e => e.delta.partial_json).join('') : call?.arguments;
        active.validToolArguments = Boolean(call && typeof JSON.parse(raw).text === 'string');
        active.passed &&= active.validToolArguments;
        const result = 'Report received. Now reply with 12 short numbered sentences summarizing the advice, about 150 words.';
        body = protocol === 'anthropic' ? { ...first, messages: [...first.messages,
          { role: 'assistant', content: [{ ...call, input: JSON.parse(raw) }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: result }] }] }
          : { ...first, input: [{ role: 'user', content: prompt }, call, { type: 'function_call_output', call_id: call.call_id, output: result }] };
      }
      delete active.native; delete active.downstream; delete active.started;
      report.cases.push(active); console.log(JSON.stringify(active));
      if (!active.passed) break;
    }
  }
  report.passed = report.cases.length === 4 && report.cases.every(c => c.passed);
} catch (e) { report.error = e.code ?? e.name; report.passed = false; }
finally {
  https.request = original; await server.shutdown();
  await writeFile(new URL('../evidence/streaming-' + (baseline ? 'baseline' : 'after') + (muse ? '-muse' : '') + '.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, error: report.error }));
if (!report.passed) process.exitCode = 1;
