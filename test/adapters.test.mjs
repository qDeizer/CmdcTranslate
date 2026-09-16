import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeAnthropic, createAnthropicEncoder, estimateTokens } from '../src/anthropic.mjs';
import { decodeResponses, createResponsesEncoder } from '../src/responses.mjs';
import { BridgeError } from '../src/core.mjs';
const p = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url)));
p.models['astra-muse'].reasoningText = 'verified';
p.models['astra-muse'].clientToolSearch = true;
const usage = { input: 100, output: 20, cacheRead: 60, cacheWrite: 10, reasoning: 5 };
const turn = { publicModel: 'astra-muse', metadata: {} };
const text = [
  { type: 'block-start', kind: 'text', segment: 0, blockId: 't' },
  { type: 'block-delta', segment: 0, blockId: 't', text: 'Merhaba 🌿' },
  { type: 'block-end', segment: 0, blockId: 't' },
];
const call = { type: 'tool-call', segment: 0, callId: 'call-one', clientName: 'read_file', kind: 'function', input: { path: 'a' }, rawArguments: '{"path":"a"}' };

test('F05 F19 Anthropic blocks, tool result round trip, usage and failed thinking', () => {
  const e = createAnthropicEncoder(turn, p), events = e.start();
  for (const event of [...text, call, { type: 'finish', reason: 'tool_use', usage }]) events.push(...e.push(event));
  assert.equal(events.at(-1).type, 'message_stop');
  const output = e.result();
  assert.equal(output.usage.input_tokens, 30);
  assert.equal(output.content[0].text, 'Merhaba 🌿');
  const replay = decodeAnthropic({ model: 'astra-muse', max_tokens: 100, messages: [
    { role: 'assistant', content: output.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-one', is_error: true, content: 'not found' }] },
  ] }, {}, p);
  assert.equal(replay.messages[1].parts[0].isError, true);
  const thinking = createAnthropicEncoder(turn); thinking.start();
  assert.throws(() => thinking.push({ type: 'block-start', kind: 'reasoning', blockId: 'r', segment: 0 }), { code: 'unsupported_reasoning_output' });
});
test('F12 F19 Responses interleaving, snapshot immutability and complete round trip', () => {
  const e = createResponsesEncoder(turn, p), events = e.start();
  const sequence = [
    text[0], { type: 'block-start', kind: 'reasoning', blockId: 'r', segment: 0 },
    text[1], call,
    { type: 'block-delta', blockId: 'r', segment: 0, text: 'check' },
  ];
  for (const event of sequence) events.push(...e.push(event));
  assert.equal(events.filter(x => x.type === 'response.output_item.done').length, 1, 'only completed tool is closed');
  const firstAdded = events.find(x => x.type === 'response.output_item.added');
  assert.deepEqual(firstAdded.item.content, []);
  events.push(...e.push({ type: 'block-end', blockId: 'r', segment: 0 }), ...e.push(text[2]),
    ...e.push({ type: 'finish', reason: 'tool_use', usage }));
  assert.deepEqual(events.map(x => x.sequence_number), events.map((_, i) => i));
  const result = e.result();
  assert.deepEqual(result, events.at(-1).response);
  assert.deepEqual(result.output.map(x => x.type), ['message', 'reasoning', 'function_call']);
  assert.equal(result.usage.input_tokens, 100);
  assert.notEqual(result.output[2].id, result.output[2].call_id);
  const decoded = decodeResponses({ model: 'astra-muse', store: false, input: [...result.output,
    { type: 'function_call_output', call_id: 'call-one', output: 'ok' }] }, {}, p);
  assert.equal(decoded.messages[1].parts[0].text, 'check');
  assert.equal(decoded.messages[3].parts[0].callId, 'call-one');
});
test('F07 typed search roundtrip and ordinary search function remain distinct', () => {
  const e = createResponsesEncoder(turn, p); e.start();
  e.push({ ...call, kind: 'tool_search', clientName: 'tool_search' });
  e.push({ type: 'finish', reason: 'tool_use', usage });
  const output = e.result().output;
  assert.equal(output[0].type, 'tool_search_call');
  const decoded = decodeResponses({ model: 'astra-muse', input: [...output, {
    type: 'tool_search_output', call_id: 'call-one', execution: 'client', status: 'completed', tools: [],
  }] }, {}, p);
  assert.equal(decoded.messages[1].parts[0].type, 'tool-search-result');
  const ordinary = createResponsesEncoder(turn, p); ordinary.start();
  assert.equal(ordinary.push({ ...call, clientName: 'search_tools' })[0].item.type, 'function_call');
});
test('F16 F20 incomplete status, typed errors, sequence and no duplicate terminal', () => {
  const e = createResponsesEncoder(turn, p); e.start();
  for (const event of text) e.push(event);
  assert.equal(e.push({ type: 'finish', reason: 'max_tokens', usage }).at(-1).type, 'response.incomplete');
  assert.equal(e.result().incomplete_details.reason, 'max_output_tokens');
  assert.deepEqual(e.fail(new BridgeError('x', 502)), []);
  const failed = createResponsesEncoder(turn, p); const start = failed.start();
  const end = failed.fail(new BridgeError('native_error', 502));
  assert.equal(end[0].sequence_number, start.length);
  assert.equal(end[0].response.status, 'failed');
  assert.throws(() => failed.result(), { code: 'incomplete_response' });
});
test('F08 F29 input image bytes, unsupported parameters and null state', () => {
  const data = 'iVBORw0KGgo=';
  const a = decodeAnthropic({ model: 'astra-muse', max_tokens: 10, messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
  ] }] }, {}, p);
  assert.equal(a.messages[0].parts[0].data, data);
  const r = decodeResponses({ model: 'astra-muse', previous_response_id: null, conversation: null, input: [
    { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,' + data }] },
  ] }, {}, p);
  assert.equal(r.messages[0].parts[0].data, data);
  for (const extra of [{ store: true }, { previous_response_id: 'x' }, { unknown: true }, { tools: [{ type: 'custom', name: 'x' }] },
    { reasoning: { effort: 'unverified' } }, { text: { verbosity: 'high' } }]) {
    assert.throws(() => decodeResponses({ model: 'astra-muse', input: 'x', ...extra }, {}, p));
  }
  assert(estimateTokens({ model: 'astra-muse', messages: [{ role: 'user', content: 'hello' }], tools: [] }).input_tokens > 0);
});
