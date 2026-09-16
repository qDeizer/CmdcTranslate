// Design artifact integrity only. This does not test or start a bridge.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(resolve(root, path), 'utf8');
const json = async path => JSON.parse(await read(path));
const docs = ['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'CONTRACTS.md',
  'IMPLEMENTATION.md', 'ACCEPTANCE.md', 'SOURCES.md'];
const [config, fixtures, baseline, pkg, types, ...documents] = await Promise.all([
  json('config.example.json'), json('fixtures/contract-cases.json'),
  json('evidence/baseline.json'), json('package.json'), read('contracts.d.ts'),
  ...docs.map(read),
]);

for (const value of [config, fixtures, baseline]) {
  assert.equal(value.contractVersion, 'astra1-v1');
}
assert.equal(config.listen.host, '127.0.0.1');
assert.equal(config.listen.port, 8742);
assert.equal(config.upstream.baseUrl, 'https://api.commandcode.ai');
assert.equal(config.upstream.path, '/alpha/generate');
assert.equal(config.upstream.cliVersion, baseline.native.version);
assert.equal(config.upstream.pauseContinuation.enabled, false);
assert.equal(config.upstream.pauseContinuation.maxSegments, 6);
assert.equal(new Set(Object.values(config.auth)).size, 3, 'Credential variables must be separate');
assert(Object.values(config.auth).every(x => /^[A-Z][A-Z0-9_]+$/.test(x)));
assert(config.upstream.projectSlug.startsWith('__SET_'), 'Example must not claim a real project');
assert.equal(pkg.private, true);
assert.equal(pkg.type, 'module');
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
for (const [key, n] of Object.entries({ ...config.limits, ...config.timeouts, ...config.prelude })) {
  assert(Number.isSafeInteger(n) && n > 0, 'Invalid limit: ' + key);
}
assert(config.timeouts.preludeMs < config.timeouts.heartbeatMs);
assert(config.timeouts.upstreamIdleMs > 307437);
assert(config.limits.turnOutputBytes >= config.limits.toolArgumentBytes);
for (const model of Object.values(config.models)) {
  assert.equal(model.upstreamModel, 'meta/muse-spark-1.3-contributor');
  assert.equal(model.reasoningText, 'verified');
  assert.deepEqual(model.efforts, ['high']);
}
assert.equal(fixtures.provenance.notLiveCapture, true);
assert.equal(baseline.astraRuntimeTests, 'NOT_RUN_RUNTIME_NOT_IMPLEMENTED');
assert.equal(baseline.liveInference, 'NOT_RUN');
assert.match(baseline.native.sha256, /^[a-f0-9]{64}$/);
assert(baseline.sources.every(x => /^[a-f0-9]{64}$/.test(x.sha256) && x.bytes > 0));
for (const type of ['SystemInput', 'Turn', 'Profile', 'BridgeEvent', 'Encoder', 'CompileNative', 'Generate', 'Acquire']) {
  assert(types.includes('export type ' + type + ' ='), 'Missing shared type: ' + type);
}
assert(types.includes('"upstream-ready"'), 'Prelude must be able to observe upstream readiness');
assert(types.includes('"tool-search-result"'), 'Typed search output must survive the internal model');

const acceptance = documents[docs.indexOf('ACCEPTANCE.md')];
const ids = new Set();
const allCases = [...fixtures.requestCases, ...fixtures.streamCases, ...fixtures.usageCases, ...fixtures.nameCases];
for (const sample of allCases) {
  assert(!ids.has(sample.id), 'Duplicate fixture ID: ' + sample.id);
  ids.add(sample.id);
  assert(sample.acceptance.length > 0);
  for (const id of sample.acceptance) assert(acceptance.includes('| ' + id + ' |'), 'Missing acceptance ID: ' + id);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
for (const id of Object.values(fixtures.fixtureContext.identity)) assert.match(id, uuid);
assert.notEqual(fixtures.fixtureContext.identity.sessionId, fixtures.fixtureContext.identity.threadId);
for (const sample of fixtures.requestCases) {
  const { method, url, headers, body } = sample.expectedNative;
  assert.equal(method, 'POST');
  assert.equal(url, config.upstream.baseUrl + config.upstream.path);
  assert.equal(headers.Authorization, 'Bearer synthetic-upstream-key');
  assert.equal(headers['x-session-id'], fixtures.fixtureContext.identity.sessionId);
  assert.equal(headers['x-command-code-version'], config.upstream.cliVersion);
  assert.equal(body.threadId, fixtures.fixtureContext.identity.threadId);
  for (const key of ['memory', 'taste', 'skills']) assert.equal(body[key], null);
  assert.equal(body.params.stream, true);
  for (const request of sample.requests) {
    assert(['anthropic', 'responses'].includes(request.protocol));
    assert.equal(body.params.model, config.models[request.body.model].upstreamModel);
    assert.equal(body.params.max_tokens, request.body.max_tokens ?? request.body.max_output_tokens ?? 64000);
  }
}
const absent = fixtures.requestCases.find(x => x.id === 'responses-null-state-absent-system');
assert(!Object.hasOwn(absent.expectedNative.body.params, 'system'));
const sections = fixtures.requestCases.find(x => x.id === 'claude-tool-error-and-sections');
assert.equal(sections.expectedNative.body.params.system[0].text, 'Birinci bölüm\n');
assert.deepEqual(sections.expectedNative.body.params.messages.map(x => x.role), ['assistant', 'tool', 'user']);
assert.equal(sections.expectedNative.body.params.messages[1].content[0].output.value, 'ENOENT: missing.txt');
for (const sample of fixtures.streamCases) {
  assert.equal(sample.eof, true);
  assert(sample.nativeEvents.every(x => typeof x.type === 'string'));
  const hasFinish = sample.nativeEvents.some(x => x.type === 'finish');
  if (sample.expected.outcome !== 'error') {
    assert(hasFinish);
    assert.equal(sample.expected.clientTerminalCount, 1);
  } else assert.equal(sample.expected.clientSuccessTerminalCount, 0);
}
for (const sample of fixtures.usageCases) {
  const n = sample.native, a = sample.expectedAnthropic, r = sample.expectedResponses;
  const d = n.inputTokenDetails;
  assert.equal(a.input_tokens, n.inputTokens - d.cacheReadTokens - d.cacheWriteTokens);
  assert.equal(r.input_tokens, n.inputTokens);
  assert.equal(r.total_tokens, n.inputTokens + n.outputTokens);
  assert.equal(r.input_tokens_details.cached_tokens, d.cacheReadTokens);
  assert.equal(r.output_tokens_details.reasoning_tokens, n.outputTokenDetails.reasoningTokens);
}
// Catch broken in-package handoff links without requiring external research folders.
for (const [i, content] of documents.entries()) {
  assert(!content.includes('\uFFFD'), 'Invalid text encoding: ' + docs[i]);
  const fences = content.split('\n').filter(line => line.startsWith('~~~')).length;
  assert.equal(fences % 2, 0, 'Unclosed code fence: ' + docs[i]);
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0].replace(/:\d+$/, '');
    if (!target || /^https?:/.test(target)) continue;
    const resolved = resolve(root, target);
    const rel = relative(root, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    await access(resolved);
  }
}
console.log('Foundation OK: ' + docs.length + ' documents, ' + allCases.length + ' synthetic cases, 18-source baseline.');
console.log('Historical baseline preserved. Current runtime/live results: evidence/release.md.');
