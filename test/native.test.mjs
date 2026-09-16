import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileNative, parseNativeLines, NativeReducer } from '../src/commandcode.mjs';
import { decodeAnthropic } from '../src/anthropic.mjs';
import { decodeResponses } from '../src/responses.mjs';
import { normalizeUsage, responsesUsage, anthropicUsage } from '../src/core.mjs';

const original = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url)));
const fixtures = JSON.parse(await readFile(new URL('../fixtures/contract-cases.json', import.meta.url)));
const context = fixtures.fixtureContext;
function profile() {
  const p = structuredClone(original);
  Object.assign(p.upstream, context.profileOverrides.upstream);
  Object.assign(p.models['astra-muse'], context.profileOverrides.models['astra-muse']);
  return p;
}
const decode = (r, p) => r.protocol === 'anthropic' ? decodeAnthropic(r.body, {}, p) : decodeResponses(r.body, {}, p);
for (const sample of fixtures.requestCases) {
  for (const request of sample.requests) test(sample.acceptance.join(' ') + ' native golden ' + sample.id + '/' + request.protocol, () => {
    const p = profile(), turn = decode(request, p);
    const native = compileNative(turn, p, context.identity, context.credentials);
    const { toolsByWireName, ...wire } = native;
    assert.deepEqual(wire, sample.expectedNative);
  });
}
for (const sample of fixtures.streamCases) test(sample.acceptance.join(' ') + ' reducer ' + sample.id, () => {
  const request = { toolsByWireName: new Map((sample.declaredTools ?? []).map(t => [t.wireName, t])) };
  const reducer = new NativeReducer(request, profile());
  const seen = [];
  const run = () => {
    for (const e of sample.nativeEvents) seen.push(...reducer.push(e));
    return reducer.close();
  };
  if (sample.expected.outcome === 'error') {
    assert.throws(run, e => sample.expected.code ? e.code === sample.expected.code : e.status === 502);
    assert.equal(seen.filter(e => e.type === 'finish').length, 0);
    if (sample.expected.executableCallCount === 0) assert.equal(seen.filter(e => e.type === 'tool-call').length, 0);
  } else {
    const result = run();
    if (sample.expected.reason) assert.equal(result.reason, sample.expected.reason);
    if (sample.expected.text) assert.equal(seen.filter(e => e.type === 'block-delta').map(e => e.text).join(''), sample.expected.text);
    if (sample.expected.calls) assert.deepEqual(seen.filter(e => e.type === 'tool-call').map(e => ({ callId: e.callId, name: e.clientName, input: e.input })), sample.expected.calls);
    assert.equal(seen.filter(e => e.type === 'finish').length, 0, 'only generate may emit validated final finish');
  }
});

test('F09 every byte boundary, CRLF, final line without newline', async () => {
  const sample = fixtures.streamCases[0].nativeEvents;
  const bytes = Buffer.from(sample.map(e => JSON.stringify(e)).join('\r\n'));
  for (let split = 0; split <= bytes.length; split++) {
    const seen = [];
    for await (const e of parseNativeLines([bytes.subarray(0, split), bytes.subarray(split)])) seen.push(e);
    assert.deepEqual(seen, sample);
  }
});
test('F10 invalid UTF8, JSON, huge line and unknown event fail', async () => {
  const read = async chunks => { for await (const _ of parseNativeLines(chunks, 40)) {} };
  await assert.rejects(read([Buffer.from([255])]), { code: 'invalid_native_utf8' });
  await assert.rejects(read([Buffer.from('{"type":oops}')]), { code: 'invalid_native_json' });
  await assert.rejects(read([Buffer.from('x'.repeat(41))]), { code: 'native_line_too_large' });
  assert.throws(() => new NativeReducer({ toolsByWireName: new Map() }, profile()).push({ type: 'not-a-type' }), { code: 'unknown_native_event' });
});
test('F02 F04 F06 compiler preserves assistant order, omits invalid thread, rejects broken history', () => {
  const p = profile();
  p.models['astra-muse'].reasoningText = 'verified';
  const body = { model: 'astra-muse', max_tokens: 100, messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'first' }, { type: 'thinking', thinking: 'second', signature: 'input-marker' }] },
    { role: 'user', content: 'continue' },
  ] };
  const turn = decodeAnthropic(body, {}, p);
  const native = compileNative(turn, p, { ...context.identity, threadId: 'invalid' }, context.credentials);
  assert(!Object.hasOwn(native.body, 'threadId'));
  assert.deepEqual(native.body.params.messages[0].content.map(x => x.type), ['text', 'reasoning']);
  const broken = structuredClone(fixtures.requestCases[1].requests[0].body);
  broken.messages.pop();
  assert.throws(() => compileNative(decodeAnthropic(broken, {}, p), p, context.identity, context.credentials), { code: 'dangling_tool_call' });
  broken.messages = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'absent', content: 'x' }] }];
  assert.throws(() => compileNative(decodeAnthropic(broken, {}, p), p, context.identity, context.credentials), { code: 'orphan_tool_result' });
});
test('F07 typed search wire binding and name collision', () => {
  const p = profile(); p.models['astra-muse'].clientToolSearch = true;
  const body = { model: 'astra-muse', input: 'find', tools: [
    { type: 'tool_search', execution: 'client', parameters: { type: 'object' } },
  ] };
  const req = compileNative(decodeResponses(body, {}, p), p, context.identity, context.credentials);
  assert.equal(req.body.params.tools[0].name, 'search_tools');
  assert.equal(req.toolsByWireName.get('search_tools').kind, 'tool_search');
  body.tools.push({ type: 'function', name: 'search_tools', parameters: { type: 'object' } });
  assert.throws(() => compileNative(decodeResponses(body, {}, p), p, context.identity, context.credentials), { code: 'tool_name_collision' });
});
test('F13 provider tool stays inside native ledger; undeclared client tool fails', () => {
  const reducer = new NativeReducer({ toolsByWireName: new Map() }, profile());
  assert.deepEqual(reducer.push({ type: 'tool-call', toolCallId: 'p', toolName: 'hosted', input: {}, providerExecuted: true }), []);
  assert.deepEqual(reducer.push({ type: 'tool-result', toolCallId: 'p', output: 'secret' }), []);
  assert.throws(() => reducer.push({ type: 'tool-call', toolCallId: 'c', toolName: 'hosted', input: {} }), { code: 'unknown_native_tool' });
});
test('F16 F18 F32 incomplete tools, unknown reasons, empty finish, missing usage', () => {
  const make = () => new NativeReducer({ toolsByWireName: new Map() }, profile());
  const r = make();
  r.push({ type: 'tool-input-start', id: 'c', toolName: 'read' });
  r.push({ type: 'finish', finishReason: 'length', totalUsage: { inputTokens: 1, outputTokens: 1 } });
  assert.equal(r.close().reason, 'max_tokens');
  for (const [reason, code] of [['mystery', 'unknown_finish_reason'], ['stop', 'empty_visible_output']]) {
    const state = make(); state.push({ type: 'finish', finishReason: reason });
    assert.throws(() => state.close(), { code });
  }
  assert.throws(() => normalizeUsage(null), { code: 'missing_usage' });
});
test('F17 F18 exact usage mappings and invalid counters', () => {
  const s = fixtures.usageCases[0], u = normalizeUsage(s.native);
  assert.deepEqual(anthropicUsage(u), s.expectedAnthropic);
  assert.deepEqual(responsesUsage(u), s.expectedResponses);
  const bad = structuredClone(s.native); bad.inputTokens = 1;
  assert.throws(() => normalizeUsage(bad), { code: 'invalid_usage' });
  assert.throws(() => normalizeUsage({ inputTokens: -1, outputTokens: 0 }), { code: 'invalid_usage' });
  assert.equal(normalizeUsage(s.native, { anthropic: { usage: { cache_creation: { ephemeral_1h_input_tokens: 3 } } } }).cacheWrite1h, 3);
});
