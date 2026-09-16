// Live Claude -> bridge -> native probe. Evidence contains timings/counts/equality only.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';
import { makeServer } from '../src/server.mjs';
import { clientSettings } from './client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = JSON.parse(await readFile(resolve(root, 'config.local.json'), 'utf8'));
const credentials = JSON.parse(await readFile(resolve(root, '.astra-secrets.json'), 'utf8'));
const who = await fetch('https://api.commandcode.ai/alpha/whoami', {
  headers: { Authorization: 'Bearer ' + credentials.upstreamKey }, redirect: 'error', signal: AbortSignal.timeout(15000),
});
if (!who.ok || (await who.json()).user?.userName !== 'deizermonokixhtf') throw Error('account_mismatch');
if (Object.values(profile.models).some(m => m.upstreamModel !== 'meta/muse-spark-1.3-contributor')) throw Error('model_mismatch');
const epoch = Date.now(), time = () => Date.now() - epoch;
const report = { startedAt: new Date().toISOString(),
  client: execFileSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
  verifiedAccount: 'deizermonokixhtf', model: 'meta/muse-spark-1.3-contributor',
  requests: [], cliText: [], errors: [], bridgeMetrics: [] };
let previous, pendingIncoming;
function parseLines(onLine) {
  let pending = ''; const decoder = new StringDecoder('utf8');
  return chunk => {
    pending += decoder.write(Buffer.from(chunk)); let n;
    while ((n = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, n).trim(); pending = pending.slice(n + 1);
      if (line) onLine(line);
    }
  };
}
const originalRequest = https.request;
https.request = function (...args) {
  const req = originalRequest.apply(this, args);
  if (String(args[0]) !== profile.upstream.baseUrl + profile.upstream.path) return req;
  const headers = args[1].headers;
  const row = { atMs: time(), incoming: pendingIncoming, nativeText: [], nativeTool: [], bridgeText: [], bridgeTool: [],
    sameSessionAsPrevious: previous ? previous.session === headers['x-session-id'] : null,
    traceparentPresent: Boolean(headers.traceparent), tracePrefix: headers.traceparent?.split('-')[1]?.slice(0, 8),
    sameTraceAsPrevious: previous ? previous.trace === headers.traceparent?.split('-')[1] : null,
    differentSpanFromPrevious: previous ? previous.span !== headers.traceparent?.split('-')[2] : null };
  report.requests.push(row);
  const end = req.end;
  req.end = function (data, ...rest) {
    const body = JSON.parse(String(data)), params = body.params;
    const stable = JSON.stringify({ config: body.config, system: params.system, tools: params.tools });
    row.samePrefixAsPrevious = previous ? stable === previous.prefix : null;
    row.sameThreadAsPrevious = previous ? body.threadId === previous.thread : null;
    row.promptCache = body.promptCache ?? 'omitted';
    row.systemCacheSections = Array.isArray(params.system) ? params.system.filter(s => s.cache_control).length : 0;
    row.model = params.model;
    previous = { session: headers['x-session-id'], thread: body.threadId, prefix: stable,
      trace: headers.traceparent?.split('-')[1], span: headers.traceparent?.split('-')[2] };
    return end.call(this, data, ...rest);
  };
  req.once('response', res => {
    row.status = res.statusCode;
    const observe = parseLines(line => {
      const e = JSON.parse(line);
      if (e.type === 'text-delta') row.nativeText.push({ atMs: time(), chars: (e.text ?? e.delta ?? '').length });
      if (e.type === 'tool-input-delta') row.nativeTool.push({ atMs: time(), chars: (e.delta ?? '').length });
      if (e.type === 'finish') {
        row.finishAtMs = time();
        const u = e.totalUsage;
        row.usage = { inputTokens: u?.inputTokens, outputTokens: u?.outputTokens,
          inputTokenDetails: Object.fromEntries(['noCacheTokens', 'cacheReadTokens', 'cacheWriteTokens']
            .filter(k => typeof u?.inputTokenDetails?.[k] === 'number').map(k => [k, u.inputTokenDetails[k]])) };
      }
    });
    const emit = res.emit;
    res.emit = function (event, ...values) { if (event === 'data') observe(values[0]); return emit.call(this, event, ...values); };
  });
  return req;
};
const server = makeServer(profile, credentials, { logger: r => {
  if (r.outcome !== 'ok') report.errors.push(r.code);
  if (r.metrics) report.bridgeMetrics.push(r.metrics);
} });
let previousHint;
server.prependListener('request', (req, res) => {
  if (!req.url.includes('/messages') || req.url.includes('count_tokens')) return;
  const chunks = [], emit = req.emit;
  req.emit = function (event, ...values) {
    if (event === 'data') chunks.push(values[0]);
    if (event === 'end') {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      let metadata; try { metadata = JSON.parse(body.metadata?.user_id); } catch {}
      const hint = metadata?.session_id ?? body.metadata?.user_id;
      pendingIncoming = { metadataFormat: metadata ? 'json' : typeof body.metadata?.user_id,
        metadataKeys: metadata ? Object.keys(metadata) : [], uuidSession: /^[0-9a-f-]{36}$/i.test(metadata?.session_id ?? ''),
        sameHintAsPrevious: previousHint === undefined ? null : hint === previousHint,
        sessionHeaderNames: Object.keys(req.headers).filter(k => /session|thread|conversation|agent-id/.test(k)) };
      previousHint = hint;
    }
    return emit.call(this, event, ...values);
  };
  const observe = parseLines(line => {
    if (!line.startsWith('data: ')) return;
    const e = JSON.parse(line.slice(6)), row = report.requests.at(-1);
    if (e.delta?.type === 'text_delta') row.bridgeText.push({ atMs: time(), chars: e.delta.text.length });
    if (e.delta?.type === 'input_json_delta') row.bridgeTool.push({ atMs: time(), chars: e.delta.partial_json.length });
  });
  const write = res.write;
  res.write = function (chunk, ...rest) { observe(chunk); return write.call(this, chunk, ...rest); };
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const settings = await clientSettings('claude', 'http://127.0.0.1:' + server.address().port,
  credentials.gatewayToken, resolve(root, '.clients/claude-continuity'), profile);
const child = spawn('claude', [...settings.args, '--bare', '-p',
  'First Read README.md. After receiving its contents, separately Read BRIEF.md. Then explain the Snake controls and game rules in 12 numbered sentences (about 250 words). Do not write any files. Finish with PROBE_DONE.',
  '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence',
  '--tools', 'Read', '--allowedTools', 'Read(./**)', '--system-prompt',
  'You are testing a Snake demo. Work only in this directory; do not access credentials, parent directories, or the network. Follow the requested Read order.'],
{ cwd: resolve(root, 'demos/snake'), env: settings.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stderr.resume();
child.stdout.on('data', parseLines(line => {
  const e = JSON.parse(line);
  if (e.type === 'stream_event' && e.event.delta?.type === 'text_delta')
    report.cliText.push({ atMs: time(), chars: e.event.delta.text.length });
  if (e.type === 'result') { report.clientIsError = e.is_error; report.finalMarker = (e.result ?? '').includes('PROBE_DONE'); }
}));
const timer = setTimeout(() => child.kill(), 240000);
try {
  report.exitCode = await new Promise((r, reject) => { child.once('exit', r); child.once('error', reject); });
  const nativeText = report.requests.flatMap(r => r.nativeText);
  report.passed = report.exitCode === 0 && report.clientIsError === false && report.finalMarker
    && report.requests.length >= 3 && report.requests.every(r => r.status === 200)
    && report.requests.slice(1).every(r => r.sameSessionAsPrevious && r.sameThreadAsPrevious)
    && nativeText.length > 1 && report.cliText.length === nativeText.length
    && report.cliText.every((e, i) => e.chars === nativeText[i].chars);
  await writeFile(resolve(root, 'evidence/continuity-' + (process.argv[2] ?? 'before') + '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, exitCode: report.exitCode, finalMarker: report.finalMarker,
    requests: report.requests.length, cliDeltas: report.cliText.length, bridgeMetrics: report.bridgeMetrics }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally { clearTimeout(timer); https.request = originalRequest; await server.shutdown(); }
