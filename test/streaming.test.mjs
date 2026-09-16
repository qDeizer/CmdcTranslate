import test from 'node:test';
import assert from 'node:assert/strict';
import { withBridge, parseSse, usage, writeNative } from './helper.mjs';

const nativeTool = (id, name, delta, input, extra = {}) => [
  { type: 'tool-input-start', id, toolName: name, ...extra },
  { type: 'tool-input-delta', id, delta, ...extra },
  { type: 'tool-input-end', id, ...extra },
  { type: 'tool-call', toolCallId: id, toolName: name, input, ...extra },
];
const finish = reason => ({ type: 'finish', finishReason: reason, totalUsage: usage });

function requestTools(protocol) {
  return protocol === 'anthropic'
    ? { tools: [{ name: 'read', input_schema: { type: 'object' } }] }
    : { tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }] };
}
function hasComplete(protocol, events) {
  return protocol === 'anthropic'
    ? events.some(e => e.type === 'content_block_stop' || e.type === 'message_stop')
    : events.some(e => e.type === 'response.function_call_arguments.done' || e.type === 'response.output_item.done' || e.type === 'response.completed');
}
async function readUntil(source, predicate) {
  const state = source.body ? { reader: source.body.getReader(), decoder: new TextDecoder(), buffer: '', all: [] } : source;
  let matched = false;
  while (!matched) {
    const next = await state.reader.read();
    assert.equal(next.done, false, 'stream ended before required preview');
    state.buffer += state.decoder.decode(next.value, { stream: true });
    const pieces = state.buffer.split('\n\n'); state.buffer = pieces.pop();
    for (const piece of pieces) {
      const data = piece.split('\n').find(line => line.startsWith('data: '));
      if (!data) continue;
      const event = JSON.parse(data.slice(6)); state.all.push(event);
      if (predicate(event, state.all)) matched = true;
    }
  }
  return state;
}
async function finishReading(state) {
  for (;;) {
    const next = await state.reader.read();
    if (next.done) break;
    state.buffer += state.decoder.decode(next.value, { stream: true });
    const pieces = state.buffer.split('\n\n'); state.buffer = pieces.pop();
    for (const piece of pieces) {
      const data = piece.split('\n').find(line => line.startsWith('data: '));
      if (data) state.all.push(JSON.parse(data.slice(6)));
    }
  }
  return state.all;
}
function argumentText(protocol, events) {
  if (protocol === 'anthropic') return events.filter(e => e.type === 'content_block_delta')
    .map(e => e.delta?.partial_json).filter(Boolean).join('');
  return events.filter(e => e.type === 'response.function_call_arguments.delta')
    .map(e => e.delta).join('');
}

for (const protocol of ['anthropic', 'responses']) test('streams a client tool preview before terminal validation: ' + protocol, async () => {
  let releaseFirst, releaseSecond, secondSent = false, terminalSent = false;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  await withBridge(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write([{ type: 'tool-input-start', id: 'call-read', toolName: 'read' },
      { type: 'tool-input-delta', id: 'call-read', delta: '{"path":' }].map(JSON.stringify).join('\n') + '\n');
    await firstGate;
    secondSent = true;
    res.write(JSON.stringify({ type: 'tool-input-delta', id: 'call-read', delta: '"a"}' }) + '\n');
    await secondGate;
    terminalSent = true;
    res.end([{ type: 'tool-input-end', id: 'call-read' },
      { type: 'tool-call', toolCallId: 'call-read', toolName: 'read', input: { path: 'a' } }, finish('tool-calls')].map(JSON.stringify).join('\n') + '\n');
  }, async ({ send }) => {
    try {
      const response = await send(protocol, { stream: true, ...requestTools(protocol) });
      let state = await readUntil(response, event => protocol === 'anthropic'
        ? event.type === 'content_block_delta' && event.delta?.partial_json === '{"path":'
        : event.type === 'response.function_call_arguments.delta' && event.delta === '{"path":');
      assert.equal(secondSent, false, 'first preview reached client before second upstream delta');
      assert.equal(hasComplete(protocol, state.all), false, 'preview must not complete a tool');
      releaseFirst();
      state = await readUntil(state, event => protocol === 'anthropic'
        ? event.type === 'content_block_delta' && event.delta?.partial_json === '"a"}'
        : event.type === 'response.function_call_arguments.delta' && event.delta === '"a"}');
      assert.equal(terminalSent, false, 'second preview reached client before upstream terminal event');
      releaseSecond();
      const events = await finishReading(state);
      assert.equal(argumentText(protocol, events), '{"path":"a"}');
      assert.equal(events.at(-1).type, protocol === 'anthropic' ? 'message_stop' : 'response.completed');
    } finally {
      releaseFirst(); releaseSecond();
    }
  });
});

for (const protocol of ['anthropic', 'responses']) test('interleaved previews preserve two tool JSON values and non-stream result: ' + protocol, async () => {
  const events = [
    { type: 'tool-input-start', id: 'one', toolName: 'read' },
    { type: 'tool-input-start', id: 'two', toolName: 'read' },
    { type: 'tool-input-delta', id: 'one', delta: '{"path":"a"}' },
    { type: 'tool-input-delta', id: 'two', delta: '{"path":"b"}' },
    { type: 'tool-input-end', id: 'two' }, { type: 'tool-call', toolCallId: 'two', toolName: 'read', input: { path: 'b' } },
    { type: 'tool-input-end', id: 'one' }, { type: 'tool-call', toolCallId: 'one', toolName: 'read', input: { path: 'a' } }, finish('tool-calls'),
  ];
  await withBridge((_req, res) => writeNative(res, events), async ({ send }) => {
    const streamed = parseSse(await (await send(protocol, { stream: true, ...requestTools(protocol) })).text());
    const deltas = protocol === 'anthropic'
      ? streamed.filter(e => e.type === 'content_block_delta').map(e => e.delta?.partial_json).filter(Boolean)
      : streamed.filter(e => e.type === 'response.function_call_arguments.delta').map(e => e.delta);
    assert.deepEqual(deltas, ['{"path":"a"}', '{"path":"b"}']);
    const json = await (await send(protocol, { stream: false, ...requestTools(protocol) })).json();
    const calls = protocol === 'anthropic' ? json.content.filter(x => x.type === 'tool_use') : json.output.filter(x => x.type === 'function_call');
    assert.deepEqual(calls.map(x => protocol === 'anthropic' ? x.input : JSON.parse(x.arguments)), [{ path: 'a' }, { path: 'b' }]);
  });
});

for (const protocol of ['anthropic', 'responses']) test('invalid previews never complete a tool or response: ' + protocol, async () => {
  const cases = [
    { code: 'tool_arguments_mismatch', events: [
      { type: 'tool-input-start', id: 'bad', toolName: 'read' }, { type: 'tool-input-delta', id: 'bad', delta: '{"path":"b"}' },
      { type: 'tool-input-end', id: 'bad' }, { type: 'tool-call', toolCallId: 'bad', toolName: 'read', input: { path: 'a' } }, finish('tool-calls'),
    ] },
    { code: 'incomplete_tool_arguments', events: [
      { type: 'tool-input-start', id: 'cut', toolName: 'read' }, { type: 'tool-input-delta', id: 'cut', delta: '{"path":' }, finish('max_tokens'),
    ] },
    { code: 'truncated_stream', events: [
      { type: 'tool-input-start', id: 'eof', toolName: 'read' }, { type: 'tool-input-delta', id: 'eof', delta: '{"path":' },
    ] },
    { code: 'tool_ownership_changed', events: [
      { type: 'tool-input-start', id: 'owner', toolName: 'read' }, { type: 'tool-input-delta', id: 'owner', delta: '{}' },
      { type: 'tool-input-end', id: 'owner' }, { type: 'tool-call', toolCallId: 'owner', toolName: 'read', input: {}, providerExecuted: true }, finish('tool-calls'),
    ] },
  ];
  for (const { code, events: native } of cases) await withBridge((_req, res) => writeNative(res, native), async ({ send, logs }) => {
    const response = await send(protocol, { stream: true, ...requestTools(protocol) });
    const events = parseSse(await response.text());
    assert(events.some(e => protocol === 'anthropic'
      ? e.type === 'content_block_delta' && e.delta?.partial_json
      : e.type === 'response.function_call_arguments.delta'), 'preview was exposed');
    assert.equal(hasComplete(protocol, events), false, 'invalid preview must not complete');
    assert.equal(events.at(-1).type, protocol === 'anthropic' ? 'error' : 'response.failed');
    assert.equal(logs.at(-1).code, code);
  });
});

for (const protocol of ['anthropic', 'responses']) test('provider-owned tools remain buffered and absent from client egress: ' + protocol, async () => {
  const native = [
    ...nativeTool('provider', 'internal_only', '{"x":1}', { x: 1 }, { providerExecuted: true }),
    { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', text: 'ok' }, { type: 'text-end', id: 't' }, finish('stop'),
  ];
  await withBridge((_req, res) => writeNative(res, native), async ({ send }) => {
    const events = parseSse(await (await send(protocol, { stream: true, ...requestTools(protocol) })).text());
    assert.equal(events.some(e => protocol === 'anthropic' ? e.content_block?.type === 'tool_use' : e.item?.type === 'function_call'), false);
    assert.equal(events.at(-1).type, protocol === 'anthropic' ? 'message_stop' : 'response.completed');
  });
});
