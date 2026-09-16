import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepare } from './run.mjs';
import { makeServer } from '../src/server.mjs';

const { profile, credentials } = await prepare();
const server = makeServer(profile, credentials, { logger: () => {} });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const reports = [];
const image = (await readFile(new URL('../fixtures/red.png', import.meta.url))).toString('base64');
async function run(protocol, stream, vision) {
  const start = Date.now(), prompt = vision ? 'Reply with only the dominant image color in uppercase English.' : 'Reply with only ASTRA_OK.';
  const body = protocol === 'anthropic'
    ? { model: 'astra-muse', max_tokens: 4096, stream, messages: [{ role: 'user',
      content: [{ type: 'text', text: prompt }, ...(vision ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } }] : [])] }] }
    : { model: 'astra-muse', max_output_tokens: 4096, stream, input: [{ role: 'user',
      content: [{ type: 'input_text', text: prompt }, ...(vision ? [{ type: 'input_image', image_url: 'data:image/png;base64,' + image }] : [])] }] };
  const res = await fetch(base + (protocol === 'anthropic' ? '/v1/messages' : '/v1/responses'), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + credentials.gatewayToken },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let content, usage, terminal, sequence;
  if (!stream) {
    const result = JSON.parse(text);
    content = protocol === 'anthropic' ? result.content?.filter(p => p.type === 'text').map(p => p.text).join('')
      : result.output?.flatMap(i => i.content ?? []).filter(p => p.type === 'output_text').map(p => p.text).join('');
    usage = result.usage; terminal = result.stop_reason ?? result.status;
  } else {
    const events = text.split('\n\n').flatMap(frame => {
      const line = frame.split('\n').find(x => x.startsWith('data: '));
      return line ? [JSON.parse(line.slice(6))] : [];
    });
    if (protocol === 'anthropic') {
      content = events.filter(e => e.delta?.type === 'text_delta').map(e => e.delta.text).join('');
      usage = events.find(e => e.type === 'message_delta')?.usage;
      terminal = events.at(-1)?.type;
    } else {
      content = events.at(-1)?.response?.output?.flatMap(i => i.content ?? []).filter(p => p.type === 'output_text').map(p => p.text).join('');
      usage = events.at(-1)?.response?.usage; terminal = events.at(-1)?.type;
      sequence = events.every((e, i) => e.sequence_number === i);
    }
  }
  const passed = res.status === 200 && content?.trim() === (vision ? 'RED' : 'ASTRA_OK') &&
    ['end_turn', 'completed', 'message_stop', 'response.completed'].includes(terminal) &&
    Number.isInteger(usage?.input_tokens) && Number.isInteger(usage?.output_tokens) && sequence !== false;
  reports.push({ protocol, stream, case: vision ? 'user-image' : 'text', status: res.status,
    exactContent: content?.trim() === (vision ? 'RED' : 'ASTRA_OK'), terminal, sequence, usage, durationMs: Date.now() - start, passed });
}
try {
  // Four independent live turns overlap through the same native gateway.
  await Promise.all([run('anthropic', false, false), run('anthropic', true, false),
    run('responses', false, false), run('responses', true, false)]);
  await Promise.all([run('anthropic', false, true), run('responses', true, true)]);
  const report = { date: new Date().toISOString(), upstreamModel: profile.models['astra-muse'].upstreamModel,
    configSha256: createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
    fourConcurrentLiveTurns: true, reports, passed: reports.every(x => x.passed) };
  await writeFile(new URL('../evidence/api-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert(report.passed, 'Live API acceptance failed');
} finally { await server.shutdown(); }
