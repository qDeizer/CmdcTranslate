import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeAnthropic, createAnthropicEncoder } from '../src/anthropic.mjs';
import { decodeResponses, createResponsesEncoder } from '../src/responses.mjs';
import { compileNative, NativeReducer } from '../src/commandcode.mjs';
import { clientSettings } from '../scripts/client.mjs';
import { example, credentials, withBridge, writeNative, textEvents } from './helper.mjs';

const p = structuredClone(example);
p.upstream.config = { workingDir: 'C:/synthetic', date: '2026-09-15', environment: 'test', structure: [],
  isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] };
const identity = { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 2 };

test('Live Claude extension: unsigned reasoning survives encoder, history and native replay', () => {
  const turn = { publicModel: 'astra-muse' }, encoder = createAnthropicEncoder(turn, p);
  encoder.start();
  for (const e of [
    { type: 'block-start', blockId: 'r', kind: 'reasoning', segment: 0 },
    { type: 'block-delta', blockId: 'r', text: 'synthetic reasoning', segment: 0 },
    { type: 'block-end', blockId: 'r', segment: 0 },
    { type: 'block-start', blockId: 't', kind: 'text', segment: 0 },
    { type: 'block-delta', blockId: 't', text: 'ok', segment: 0 },
    { type: 'block-end', blockId: 't', segment: 0 },
    { type: 'finish', reason: 'end_turn', usage },
  ]) encoder.push(e);
  const output = encoder.result().content;
  assert.equal(output[0].thinking, 'synthetic reasoning');
  assert(!Object.hasOwn(output[0], 'signature'));
  const replay = decodeAnthropic({ model: 'astra-muse', max_tokens: 100, output_config: { effort: 'high' },
    messages: [{ role: 'assistant', content: output }, { role: 'user', content: 'continue' }] }, {}, p);
  const native = compileNative(replay, p, identity, credentials).body.params;
  assert.deepEqual(native.messages[0].content[0], { type: 'reasoning', text: 'synthetic reasoning' });
  assert.equal(native.reasoning_effort, 'high');
});

test('Live cache hints and system message extension preserve text and error results', () => {
  const cache_control = { type: 'ephemeral' };
  const turn = decodeAnthropic({ model: 'astra-muse', max_tokens: 100, messages: [
    { role: 'system', content: 'system extension' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'not found', is_error: true, cache_control },
      { type: 'text', text: 'continue', cache_control }] },
  ], tools: [{ name: 'Read', input_schema: { type: 'object' }, cache_control }] }, {}, p);
  const native = compileNative(turn, p, identity, credentials).body.params;
  assert.equal(native.system[0].text, 'system extension');
  assert.equal(native.messages[1].content[0].output.value, 'not found');
  assert.equal(native.messages[2].content[0].text, 'continue');
});

test('Namespaced functions with identical names retain binding across a complete turn', () => {
  const tools = ['alpha', 'beta'].map(name => ({ type: 'namespace', name, description: name + ' docs',
    tools: [{ type: 'function', name: 'read', description: 'read docs', parameters: { type: 'object' } }] }));
  const turn = decodeResponses({ model: 'astra-muse', input: 'read', tools,
    client_metadata: { transport: 'http' }, include: ['reasoning.encrypted_content'] }, {}, p);
  const native = compileNative(turn, p, identity, credentials);
  const [a, b] = native.body.params.tools;
  assert.notEqual(a.name, b.name);
  assert.equal(a.description, 'alpha docs\nread docs');
  const reducer = new NativeReducer(native, p);
  const event = reducer.push({ type: 'tool-call', toolCallId: 'one', toolName: b.name, input: {} })[0];
  const encoder = createResponsesEncoder(turn, p);
  encoder.start(); encoder.push(event); encoder.push({ type: 'finish', reason: 'tool_use', usage });
  const output = encoder.result().output;
  assert.equal(output[0].namespace, 'beta'); assert.equal(output[0].name, 'read');
  const replay = decodeResponses({ model: 'astra-muse', tools, input: [...output,
    { type: 'function_call_output', call_id: 'one', output: 'ok' }] }, {}, p);
  const wire = compileNative(replay, p, identity, credentials).body.params.messages;
  assert.equal(wire[0].content[0].toolName, b.name);
  assert.equal(wire[1].content[0].toolName, b.name);
});

for (const protocol of ['anthropic', 'responses']) test('F08 tool image byte preservation and promotion: ' + protocol, async () => {
  const data = 'iVBORw0KGgo=';
  const image = protocol === 'anthropic' ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
    : { type: 'input_image', image_url: 'data:image/png;base64,' + data, detail: 'high' };
  const body = protocol === 'anthropic' ? { messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'one', name: 'picture', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: [{ type: 'text', text: 'caption' }, image] }] },
  ] } : { input: [{ type: 'function_call', call_id: 'one', name: 'picture', arguments: '{}' },
    { type: 'function_call_output', call_id: 'one', output: [{ type: 'input_text', text: 'caption' }, image] }] };
  await withBridge((_req, res) => writeNative(res, textEvents), async ({ send, calls }) => {
    const response = await send(protocol, body);
    assert.equal(response.status, 200); await response.text();
    const m = calls[0].body.params.messages;
    assert.deepEqual(m.map(x => x.role), ['assistant', 'tool', 'user']);
    assert.equal(m[1].content[0].output.value, 'caption');
    assert.equal(m[1].content[0].toolCallId, 'one');
    assert.equal(m[2].content[0].image, 'data:image/png;base64,' + data);
  });
});

test('saved aliases drive Claude settings and the generated Codex catalog', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'astra-client-'));
  try {
    const profile = structuredClone(p);
    profile.models = { 'codex-custom': p.models['astra-muse'], 'claude-custom': p.models['claude-astra-muse'] };
    const claudeHome = join(temporary, 'claude'), codexHome = join(temporary, 'codex');
    const claude = await clientSettings('claude', 'http://127.0.0.1:8742', credentials.gatewayToken, claudeHome, profile);
    assert.deepEqual(claude.args.slice(0, 2), ['--model', 'claude-custom']);
    const settings = JSON.parse(await readFile(join(claudeHome, 'astra-settings.json'), 'utf8'));
    assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
    assert.deepEqual(settings.modelPicker.options.map(row => row.model), Object.keys(profile.models));
    assert.deepEqual(settings.availableModels, Object.keys(profile.models));
    const codex = await clientSettings('codex', 'http://127.0.0.1:8742', credentials.gatewayToken, codexHome, profile);
    assert.deepEqual(codex.args.slice(0, 2), ['-m', 'codex-custom']);
    const catalog = JSON.parse(await readFile(join(codexHome, 'models.json'), 'utf8'));
    assert.equal(catalog.models[0].slug, 'codex-custom');
    assert.deepEqual(catalog.models.map(row => row.slug), Object.keys(profile.models));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
