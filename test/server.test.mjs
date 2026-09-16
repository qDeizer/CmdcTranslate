import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSessions } from '../src/session.mjs';
import { writeFrame, validateProfile } from '../src/server.mjs';
import { withBridge, writeNative, textEvents, usage, credentials, example, parseSse } from './helper.mjs';

for (const protocol of ['anthropic', 'responses']) {
  for (const stream of [true, false]) test('F01 F19 real HTTP round trip ' + protocol + '/' + stream, async () => {
    await withBridge((_req, res) => writeNative(res, textEvents), async ({ send, calls }) => {
      const response = await send(protocol, { stream });
      assert.equal(response.status, 200);
      const data = stream ? parseSse(await response.text()) : await response.json();
      const final = stream ? protocol === 'responses' ? data.at(-1).response : data.find(x => x.type === 'message_delta') : data;
      assert.equal(final.usage.input_tokens, protocol === 'anthropic' ? 30 : 100);
      if (stream) {
        if (protocol === 'responses') assert.deepEqual(data.map(x => x.sequence_number), data.map((_, i) => i));
        else assert.equal(data.at(-1).type, 'message_stop');
      }
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, '/alpha/generate');
      assert.equal(calls[0].headers.authorization, 'Bearer ' + credentials.upstreamKey);
      assert.notEqual(calls[0].headers['x-session-id'], calls[0].body.threadId);
      assert.equal(calls[0].body.params.stream, true);
    });
  });
}
test('F14 F15 F20 F22 early error, truncated stream and error after finish never succeed', async () => {
  for (const events of [[{ type: 'error', error: 'synthetic-secret' }], textEvents.slice(0, 4), [...textEvents.slice(0, 5), { type: 'error', error: 'synthetic-secret' }]]) {
    await withBridge((_req, res) => writeNative(res, events), async ({ send, calls }) => {
      for (const protocol of ['anthropic', 'responses']) {
        const response = await send(protocol, { stream: true });
        const text = await response.text();
        assert(!text.includes('synthetic-secret'));
        assert(!text.includes('response.completed'));
        assert(!text.includes('message_stop'));
        if (events.length === 1) assert.equal(response.status, 502);
        else {
          const data = parseSse(text);
          assert.equal(data.at(-1).type, protocol === 'anthropic' ? 'error' : 'response.failed');
          if (protocol === 'responses') assert.deepEqual(data.map(x => x.sequence_number), data.map((_, i) => i));
        }
      }
      assert.equal(calls.length, 2);
    });
  }
});
test('F21 heartbeat before first content and body-idle timeout are independent', async () => {
  await withBridge(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.flushHeaders();
    await sleep(130);
    res.end(textEvents.map(e => JSON.stringify(e)).join('\n'));
  }, async ({ send }) => {
    const response = await send('responses', { stream: true });
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    assert(first.includes('response.created'));
    let all = first;
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; all += decoder.decode(chunk.value); }
    assert(all.includes(': keepalive'));
    assert.equal(parseSse(all).at(-1).type, 'response.completed');
  });
  await withBridge((_req, res) => { res.writeHead(200); res.flushHeaders(); }, async ({ send }) => {
    const response = await send('responses', { stream: true });
    const text = await response.text();
    assert(text.includes('upstream_idle_timeout'));
    assert(!text.includes('response.completed'));
  }, p => { p.timeouts.upstreamIdleMs = 100; });
});
test('F24 header timeout, tail timeout, disconnect abort and session release', async () => {
  await withBridge(() => {}, async ({ send }) => {
    const response = await send('responses', { stream: true });
    assert.equal(response.status, 504);
  }, p => { p.timeouts.upstreamHeadersMs = 60; });
  await withBridge((_req, res) => { res.writeHead(200); res.write(textEvents.map(e => JSON.stringify(e)).join('\n') + '\n'); }, async ({ send }) => {
    const response = await send('responses', { stream: true });
    assert((await response.text()).includes('terminal_drain_timeout'));
  }, p => { p.timeouts.terminalDrainMs = 60; });
  let closed;
  const upstreamClosed = new Promise(r => { closed = r; });
  await withBridge((_req, res) => {
    res.on('close', closed); res.writeHead(200); res.flushHeaders();
  }, async ({ send, server }) => {
    const abort = new AbortController();
    const response = await send('responses', { stream: true }, { signal: abort.signal, headers: { 'thread-id': 'cancel-test' } });
    const reader = response.body.getReader(); await reader.read(); abort.abort();
    await assert.rejects(reader.read());
    await Promise.race([upstreamClosed, sleep(1000).then(() => { throw Error('upstream not cancelled'); })]);
    await sleep(30);
    assert.equal(server.sessions.stats().active, 0);
  });
});
test('F23 writer close-before-drain removes all temporary listeners', async () => {
  const res = new EventEmitter(); res.destroyed = false; res.writableEnded = false;
  res.write = () => false;
  const abort = new AbortController(), pending = writeFrame(res, 'synthetic', abort.signal, 100);
  res.destroyed = true; res.emit('close');
  await assert.rejects(pending, { code: 'client_disconnected' });
  assert.equal(res.listenerCount('drain'), 0); assert.equal(res.listenerCount('error'), 0);
});
test('F25 F26 F27 session isolation, active TTL, capacity, cache key and release', () => {
  const p = structuredClone(example); p.timeouts.sessionIdleTtlMs = 10; p.limits.maxActiveTurns = 4;
  let clock = 100;
  const s = createSessions(credentials.sessionSecret, p, () => clock);
  const ctx = { principal: 'p', upstreamAccount: 'a', workspaceId: 'w', protocol: 'responses', conversationHint: 'one' };
  const first = s.acquire(ctx); clock += 11;
  assert.throws(() => s.acquire(ctx), { code: 'conversation_busy' });
  const other = s.acquire({ ...ctx, agentHint: 'agent-2' });
  const third = s.acquire({ ...ctx, conversationHint: 'other', prompt_cache_key: 'shared' });
  const fourth = s.acquire({ ...ctx, conversationHint: undefined, prompt_cache_key: 'shared' });
  assert.equal(new Set([first, other, third, fourth].map(x => x.identity.sessionId)).size, 4);
  assert.throws(() => s.acquire({ ...ctx, conversationHint: 'five' }), { code: 'capacity_exceeded' });
  first.release(); first.release();
  const again = s.acquire(ctx); assert.deepEqual(first.identity, again.identity);
  for (const lease of [again, other, third, fourth]) lease.release();
  assert.equal(s.stats().active, 0);
  clock += 11;
  const afterExpiry = s.acquire(ctx);
  assert.deepEqual(first.identity, afterExpiry.identity); afterExpiry.release();
  const restarted = createSessions(credentials.sessionSecret, p, () => clock);
  const resumed = restarted.acquire(ctx);
  assert.deepEqual(first.identity, resumed.identity); resumed.release();
  for (const difference of [{ upstreamAccount: 'b' }, { workspaceId: 'w2' }, { protocol: 'anthropic' }]) {
    const isolated = restarted.acquire({ ...ctx, ...difference });
    assert.notEqual(first.identity.sessionId, isolated.identity.sessionId); isolated.release();
  }
  const rotated = createSessions('different-secret-'.repeat(3), p).acquire(ctx);
  assert.notEqual(first.identity.sessionId, rotated.identity.sessionId); rotated.release();
});
test('F25 four actual HTTP turns overlap and same binding gets 409', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  await withBridge(async (_req, res) => { await gate; writeNative(res, textEvents); }, async ({ send, calls }) => {
    const requests = [0, 1, 2, 3].map(i => send('responses', {}, { headers: { 'thread-id': 't' + i } }));
    try {
      for (let i = 0; calls.length < 4 && i < 50; i++) await sleep(10);
      assert.equal(calls.length, 4);
      const duplicate = await send('responses', {}, { headers: { 'thread-id': 't0' } });
      assert.equal(duplicate.status, 409);
      release();
      for (const response of await Promise.all(requests)) { assert.equal(response.status, 200); await response.text(); }
    } finally { release(); await Promise.allSettled(requests); }
  });
});
test('F28 F29 F30 F33 auth, count_tokens error boundary, limits, no secret logging', async () => {
  await withBridge((_req, res) => writeNative(res, textEvents), async ({ send, url, calls, logs }) => {
    assert.equal((await fetch(url + '/v1/models')).status, 401);
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + credentials.gatewayToken };
    assert.equal((await fetch(url + '/v1/messages/count_tokens', { method: 'POST', headers, body: '{' })).status, 400);
    const count = await fetch(url + '/v1/messages/count_tokens', { method: 'POST', headers,
      body: JSON.stringify({ model: 'astra-muse', messages: [{ role: 'user', content: 'secret-prompt-sentinel' }] }) });
    assert.equal(count.status, 200); assert.equal(count.headers.get('x-astra-token-count'), 'estimate');
    const conflict = await send('responses', {}, { headers: { 'x-api-key': 'wrong-key' } });
    assert.equal(conflict.status, 401);
    const unsupported = await send('responses', { previous_response_id: 'secret-session' });
    assert.equal(unsupported.status, 422);
    const oversized = await send('responses', { input: 'x'.repeat(2000) });
    assert.equal(oversized.status, 413);
    assert.equal(calls.length, 0);
    assert.equal((await fetch(url + '/healthz')).status, 200);
    const logged = JSON.stringify(logs);
    for (const sentinel of [credentials.gatewayToken, credentials.upstreamKey, credentials.sessionSecret, 'secret-prompt-sentinel', 'secret-session', 'wrong-key']) assert(!logged.includes(sentinel));
  }, p => { p.limits.requestBytes = 1000; });
});
test('F30 output limit and upstream HTTP errors do not retry', async () => {
  await withBridge((_req, res) => writeNative(res, textEvents), async ({ send, calls }) => {
    const response = await send('responses', {});
    assert.equal(response.status, 502); assert.equal(calls.length, 1);
  }, p => { p.limits.turnOutputBytes = 20; });
  await withBridge((_req, res) => { res.writeHead(429, { 'retry-after': '30' }); res.end('secret-upstream-error'); }, async ({ send, calls }) => {
    const response = await send('responses', {});
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '30');
    assert(!(await response.text()).includes('secret-upstream-error')); assert.equal(calls.length, 1);
  });
});
test('F31 pause continuation reuses body/session and emits one final with summed usage', async () => {
  await withBridge((_req, res, calls) => writeNative(res, [
    ...textEvents.slice(0, 4), { type: 'finish', rawFinishReason: calls.length === 1 ? 'pause_turn' : 'stop', totalUsage: usage },
  ]), async ({ send, calls }) => {
    const response = await send('responses', { stream: true });
    const events = parseSse(await response.text());
    assert.equal(events.filter(e => e.type === 'response.completed').length, 1);
    assert.equal(events.at(-1).response.usage.input_tokens, 200);
    assert.deepEqual(calls[0].body, calls[1].body);
    assert.equal(calls[0].headers['x-session-id'], calls[1].headers['x-session-id']);
  }, p => { p.upstream.pauseContinuation.enabled = true; });
  for (const enabled of [false, true]) await withBridge((_req, res) => writeNative(res, [
    ...textEvents.slice(0, 4), { type: 'finish', rawFinishReason: 'pause_turn', totalUsage: usage },
  ]), async ({ send, calls }) => {
    const response = await send('responses', {});
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, enabled ? 'continuation_limit' : 'pause_continuation_unverified');
    assert.equal(calls.length, enabled ? 6 : 1);
  }, p => { p.upstream.pauseContinuation.enabled = enabled; });
});
test('F34 startup rejects placeholders and external test override', () => {
  assert.throws(() => validateProfile(example, credentials), { code: 'invalid_config' });
  const p = structuredClone(example); p.upstream.baseUrl = 'http://example.com';
  assert.throws(() => validateProfile(p, credentials, { allowTestUpstream: true }), { code: 'invalid_upstream_url' });
});

test('local admin UI keeps secrets hidden and applies validated config', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'astra-admin-'));
  const configPath = join(temporary, 'config.json'), secretsPath = join(temporary, 'secrets.json');
  await writeFile(configPath, JSON.stringify(example));
  await writeFile(secretsPath, JSON.stringify(credentials));
  try {
    await withBridge((req, res) => {
      if (req.url === '/alpha/whoami') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { userName: 'synthetic-user' }, org: null }));
      } else writeNative(res, textEvents);
    }, async ({ url, profile, server, calls }) => {
      const page = await fetch(url + '/');
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
      const initialResponse = await fetch(url + '/admin/config');
      const initialText = await initialResponse.text();
      assert.equal(initialResponse.status, 200);
      for (const secret of Object.values(credentials)) assert(!initialText.includes(secret));
      const initial = JSON.parse(initialText);
      const modelsResponse = await fetch(url + '/admin/models', { headers: { 'x-astra-admin': initial.csrf } });
      assert.equal(modelsResponse.status, 200);
      const liveCatalog = await modelsResponse.json();
      assert.equal(liveCatalog.account.userName, 'synthetic-user');
      assert(Object.keys(liveCatalog.catalog.models).length > 70);
      assert(Object.hasOwn(liveCatalog.catalog.models, 'meta/muse-spark-1.3-contributor'));
      assert.equal(calls.at(-1).url, '/alpha/whoami');
      assert.equal(calls.at(-1).headers.authorization, 'Bearer ' + credentials.upstreamKey);
      const untrustedHost = await new Promise((resolveStatus, reject) => get(url + '/admin/config',
        { headers: { host: 'untrusted.example' } }, res => { res.resume(); resolveStatus(res.statusCode); }).on('error', reject));
      assert.equal(untrustedHost, 403);
      for (const path of ['/admin/requests', '/admin/account']) assert.equal((await fetch(url + path)).status, 403);
      assert.equal((await fetch(url + '/admin/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"client":"claude"}' })).status, 403);
      assert.equal((await fetch(url + '/admin/launch', { method: 'POST', headers: { 'content-type': 'application/json', 'x-astra-admin': initial.csrf }, body: '{"client":"invalid"}' })).status, 422);
      const body = {
        apiKey: 'new-ui-upstream-secret',
        upstreamModel: 'synthetic/model', codexAlias: 'codex-ui', claudeAlias: 'claude-ui', maxTokens: 4096,
        workspaceId: resolve('.'), projectSlug: 'astra-ui-test', permissionMode: 'plan', tasteLearning: true,
      };
      const denied = await fetch(url + '/admin/config', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(denied.status, 403);
      const saved = await fetch(url + '/admin/config', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-astra-admin': initial.csrf }, body: JSON.stringify(body),
      });
      assert.equal(saved.status, 200);
      const savedText = await saved.text();
      for (const secret of [...Object.values(credentials), body.apiKey]) assert(!savedText.includes(secret));
      assert.deepEqual(Object.keys(profile.models), ['codex-ui', 'claude-ui']);
      assert.equal(profile.upstream.permissionMode, 'plan');
      const disk = JSON.parse(await readFile(configPath, 'utf8'));
      assert.equal(disk.models['codex-ui'].upstreamModel, 'synthetic/model');
      assert.equal(JSON.parse(await readFile(secretsPath, 'utf8')).upstreamKey, body.apiKey);
      const models = structuredClone(profile.models);
      models['third-ui'] = { ...models['codex-ui'], upstreamModel: 'synthetic/other', efforts: ['low', 'high'],
        effortMap: { default: 'low', none: 'omit', minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'high', max: 'reject' } };
      const modern = { workspaceId: resolve('.'), projectSlug: 'astra-ui-test', permissionMode: 'plan', tasteLearning: true,
        models, clients: { claude: { model: 'third-ui', effort: 'low' }, codex: { model: 'codex-ui', effort: 'high' } }, traceMode: 'conversation' };
      const post = value => fetch(url + '/admin/config', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-astra-admin': initial.csrf }, body: JSON.stringify(value) });
      assert.equal((await post(modern)).status, 200);
      const modernDisk = JSON.parse(await readFile(configPath, 'utf8'));
      assert.deepEqual(modernDisk.models, models);
      assert.deepEqual(modernDisk.clients, modern.clients);
      assert.equal(modernDisk.traceMode, 'conversation');
      modern.clients.claude.effort = 'max';
      assert.equal((await post(modern)).status, 422);
      assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), modernDisk, 'rejected save must leave prior config intact');
      assert.equal(server.diagnostics.length, 0, 'admin traffic is not inference traffic');
    }, undefined, { admin: { configPath, secretsPath } });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Claude metadata session UUID binds turns without merging user/account identities', async () => {
  await withBridge((_req, res) => writeNative(res, textEvents), async ({ send, calls }) => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    for (const user_id of [JSON.stringify({ user_id: 'same-user', session_id: id }),
      'user_same_account_same_session_' + id, 'same-user', 'same-user']) {
      const res = await send('anthropic', { metadata: { user_id } });
      assert.equal(res.status, 200); await res.text();
    }
    assert.equal(calls[0].headers['x-session-id'], calls[1].headers['x-session-id']);
    assert.notEqual(calls[2].headers['x-session-id'], calls[3].headers['x-session-id']);
  });
});

for (const protocol of ['anthropic', 'responses']) test('text crosses HTTP before next native delta and terminal: ' + protocol, async () => {
  let next, finish;
  const nextGate = new Promise(r => { next = r; });
  const finishGate = new Promise(r => { finish = r; });
  await withBridge(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const write = e => res.write(JSON.stringify(e) + '\n');
    write({ type: 'text-start', id: 'live' });
    write({ type: 'text-delta', id: 'live', text: 'first-piece' });
    await nextGate;
    write({ type: 'text-delta', id: 'live', text: 'second-piece' });
    await finishGate;
    write({ type: 'text-end', id: 'live' });
    write({ type: 'finish', finishReason: 'stop', totalUsage: usage });
    res.end();
  }, async ({ send, logs }) => {
    try {
      const response = await send(protocol, { stream: true });
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let text = '';
      const until = async marker => {
        while (!text.includes(marker)) {
          const chunk = await reader.read(); assert.equal(chunk.done, false);
          text += decoder.decode(chunk.value, { stream: true });
        }
      };
      await until('first-piece');
      assert(!text.includes('second-piece'));
      assert(!/message_stop|response.completed/.test(text));
      next(); await until('second-piece');
      assert(!/message_stop|response.completed/.test(text));
      finish();
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value); }
      assert.equal(parseSse(text).at(-1).type, protocol === 'anthropic' ? 'message_stop' : 'response.completed');
      assert.equal(logs.at(-1).metrics.textDeltas, 2);
    } finally { next(); finish(); }
  });
});

test('cache telemetry distinguishes unknown from zero; prefix equality never logs content', async () => {
  await withBridge((_req, res, calls) => writeNative(res, [
    ...textEvents.slice(0, 4), { type: 'finish', finishReason: 'stop', totalUsage: {
      inputTokens: 10, outputTokens: 2,
      ...(calls.length > 1 ? { inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0, noCacheTokens: 10 } } : {}),
    } },
  ]), async ({ send, logs }) => {
    for (const system of ['private-prefix-sentinel', 'private-prefix-sentinel', 'changed-prefix-sentinel']) {
      const response = await send('anthropic', { system }, { headers: { 'x-astra-conversation-id': 'private-session-sentinel' } });
      assert.equal(response.status, 200); await response.text();
    }
    const [first, second, third] = logs.map(r => r.metrics);
    assert.equal(first.conversationBound, true);
    assert.equal(first.samePrefixAsPrevious, null);
    assert.equal(first.cacheReadTokens, null);
    assert.equal(first.cacheWriteTokens, null);
    assert.equal(first.uncachedInputTokens, null);
    assert.equal(second.samePrefixAsPrevious, true);
    assert.equal(second.cacheReadTokens, 0);
    assert.equal(second.uncachedInputTokens, 10);
    assert.equal(third.samePrefixAsPrevious, false);
    assert(!JSON.stringify(logs).includes('sentinel'));
  });
});

for (const protocol of ['anthropic', 'responses']) test('configured effort routing and conversation trace reach native HTTP: ' + protocol, async () => {
  await withBridge((_req, res) => writeNative(res, textEvents), async ({ send, calls, server }) => {
    const options = { headers: { 'x-astra-conversation-id': 'synthetic-conversation' } };
    for (const effort of [undefined, 'max', 'none']) {
      const body = effort === undefined ? {} : protocol === 'anthropic' ? { output_config: { effort } } : { reasoning: { effort } };
      const res = await send(protocol, body, options);
      assert.equal(res.status, 200); await res.text();
    }
    assert.deepEqual(calls.map(c => c.body.params.reasoning_effort), ['low', 'xhigh', undefined]);
    const traces = calls.map(c => c.headers.traceparent.split('-'));
    assert.equal(new Set(traces.map(t => t[1])).size, 1);
    assert.equal(new Set(traces.map(t => t[2])).size, 3);
    assert(traces.every(t => /^[a-f0-9]{32}$/.test(t[1]) && /^[a-f0-9]{16}$/.test(t[2])));
    const another = await send(protocol, {}, { headers: { 'x-astra-conversation-id': 'other-conversation' } }); await another.text();
    assert.notEqual(calls[3].headers.traceparent.split('-')[1], traces[0][1]);
    assert.equal(server.diagnostics[0].metrics.requestedEffort, null);
    assert.equal(server.diagnostics[1].metrics.upstreamEffort, 'xhigh');
    const bad = protocol === 'anthropic' ? { output_config: { effort: 'ultra' } } : { reasoning: { effort: 'ultra' } };
    const denied = await send(protocol, bad); assert.equal(denied.status, 422);
    assert.equal(calls.length, 4);
  }, p => {
    p.traceMode = 'conversation';
    const m = p.models['astra-muse']; m.efforts = ['low', 'medium', 'high', 'xhigh'];
    m.effortMap = { default: 'low', none: 'omit', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };
  });
});

test('unsupported native effort and invalid startup selection cannot be saved', () => {
  const p = structuredClone(example);
  p.upstream.projectSlug = 'synthetic'; p.upstream.workspaceId = 'C:/synthetic';
  p.upstream.config = { workingDir: 'C:/synthetic', date: '2026-09-15', environment: 'test', structure: [],
    isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] };
  const m = p.models['astra-muse'];
  m.efforts = ['max'];
  m.effortMap = Object.fromEntries(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(e => [e, 'max']));
  assert.throws(() => validateProfile(p, credentials), { code: 'unsupported_model_effort' });
  m.efforts = ['high']; for (const key in m.effortMap) m.effortMap[key] = 'high';
  p.clients = { claude: { model: 'missing', effort: 'high' }, codex: { model: 'astra-muse', effort: 'high' } };
  assert.throws(() => validateProfile(p, credentials), { code: 'invalid_client_model' });
});
