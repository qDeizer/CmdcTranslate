import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BridgeError, ensure, object, safeError, errorBody, modelFor, validateNativeConfig, effortInputs, clientDefaults } from './core.mjs';
import catalog from '../commandcode.models.json' with { type: 'json' };
import { decodeAnthropic, createAnthropicEncoder, estimateTokens } from './anthropic.mjs';
import { decodeResponses, createResponsesEncoder } from './responses.mjs';
import { compileNative, generate } from './commandcode.mjs';
import { createSessions } from './session.mjs';
import { createAdmin } from './admin.mjs';

const routes = new Map([
  ['/healthz', ['GET', 'health']],
  ['/v1/models', ['GET', 'models']],
  ['/v1/messages', ['POST', 'anthropic']],
  ['/v1/v1/messages', ['POST', 'anthropic']],
  ['/v1/messages/count_tokens', ['POST', 'count']],
  ['/v1/v1/messages/count_tokens', ['POST', 'count']],
  ['/v1/responses', ['POST', 'responses']],
]);
export function validateProfile(profile, credentials, { allowTestUpstream = false } = {}) {
  ensure(profile?.contractVersion === 'astra1-v1', 'invalid_config', 503);
  const { listen, upstream: u, models, limits, timeouts, prelude, auth } = profile;
  ensure(listen?.host === '127.0.0.1' && Number.isInteger(listen.port) && listen.port >= 0 && listen.port <= 65535, 'invalid_config', 503);
  let url;
  try { url = new URL(u.baseUrl); } catch { throw new BridgeError('invalid_config', 503); }
  ensure(url.username === '' && url.password === '' && url.search === '' && url.hash === '' && url.pathname === '/', 'invalid_config', 503);
  ensure(u.baseUrl === 'https://api.commandcode.ai' || (allowTestUpstream && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)),
    'invalid_upstream_url', 503);
  ensure(u.path === '/alpha/generate' && u.cliVersion === '1.54.0' && u.cliEnvironment === 'production', 'invalid_config', 503);
  for (const value of [u.projectSlug, u.workspaceId]) ensure(typeof value === 'string' && value.length > 0 && value.length < 512 && !value.startsWith('__SET_') && !/[\r\n]/.test(value), 'invalid_config', 503);
  validateNativeConfig(u.config);
  ensure(['standard', 'auto-accept', 'plan'].includes(u.permissionMode) && typeof u.tasteLearning === 'boolean' && typeof u.includeThreadId === 'boolean', 'invalid_config', 503);
  ensure(u.pauseContinuation?.maxSegments === 6 && typeof u.pauseContinuation.enabled === 'boolean', 'invalid_config', 503);
  for (const key of ['listen', 'upstream', 'models', 'limits', 'timeouts', 'prelude', 'auth']) object(profile[key], 'config');
  const requiredLimits = ['requestBytes', 'nativeLineBytes', 'toolArgumentBytes', 'turnOutputBytes', 'maxActiveTurns', 'maxSessions'];
  const requiredTimes = ['bodyReadMs', 'upstreamHeadersMs', 'upstreamIdleMs', 'downstreamStallMs', 'terminalDrainMs', 'preludeMs', 'heartbeatMs', 'sessionIdleTtlMs'];
  for (const [values, keys] of [[limits, requiredLimits], [timeouts, requiredTimes], [prelude, ['maxBytes', 'maxEvents']]]) {
    for (const key of keys) ensure(Number.isSafeInteger(values[key]) && values[key] > 0 && values[key] <= 2147483647, 'invalid_config', 503);
  }
  ensure(Object.keys(models).length > 0, 'invalid_config', 503);
  ensure(Object.keys(models).length <= 32 && Object.keys(models).every(n => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(n)), 'invalid_model_alias', 422);
  ensure(profile.traceMode === undefined || ['conversation', 'request'].includes(profile.traceMode), 'invalid_trace_mode', 422);
  for (const model of Object.values(models)) {
    ensure(typeof model.upstreamModel === 'string' && model.upstreamModel.length && Number.isSafeInteger(model.defaultMaxTokens) && model.defaultMaxTokens > 0, 'invalid_config', 503);
    ensure(typeof model.vision === 'boolean' && ['none-observed', 'verified'].includes(model.reasoningText) && Array.isArray(model.efforts) && model.efforts.every(x => typeof x === 'string'), 'invalid_config', 503);
    if (model.maxOutputTokens !== undefined) ensure(Number.isSafeInteger(model.maxOutputTokens) && model.maxOutputTokens >= model.defaultMaxTokens, 'invalid_config', 503);
    if (model.temperatureRange !== undefined) ensure(Array.isArray(model.temperatureRange) && model.temperatureRange.length === 2 && model.temperatureRange.every(Number.isFinite) && model.temperatureRange[0] <= model.temperatureRange[1], 'invalid_config', 503);
    if (model.effortMap !== undefined) {
      object(model.effortMap, 'effortMap');
      ensure(Object.keys(model.effortMap).length === effortInputs.length && effortInputs.every(k =>
        ['omit', 'reject', ...model.efforts].includes(model.effortMap[k])), 'invalid_effort_map', 422);
      const known = catalog.models[model.upstreamModel];
      ensure(!known || model.efforts.every(e => known.includes(e)), 'unsupported_model_effort', 422);
    }
  }
  for (const [client, setting] of Object.entries(clientDefaults(profile))) {
    ensure(['claude', 'codex'].includes(client) && Object.hasOwn(models, setting.model), 'invalid_client_model', 422);
    const levels = client === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    ensure(levels.includes(setting.effort), 'invalid_client_effort', 422);
    const target = models[setting.model];
    ensure(!target.effortMap || target.effortMap[setting.effort] !== 'reject', 'invalid_client_effort', 422);
  }
  ensure(clientDefaults(profile).claude && clientDefaults(profile).codex, 'invalid_client_model', 422);
  ensure(new Set(Object.values(auth)).size === 3 && Object.values(auth).every(x => typeof x === 'string' && /^[A-Z][A-Z0-9_]+$/.test(x)), 'invalid_config', 503);
  for (const key of ['gatewayToken', 'sessionSecret']) ensure(typeof credentials[key] === 'string' && credentials[key].length >= 32, 'missing_gateway_secrets', 503);
  ensure(typeof credentials.upstreamKey === 'string' && credentials.upstreamKey.length > 0 && !/[\r\n]/.test(credentials.upstreamKey), 'missing_upstream_key', 503);
  ensure(credentials.gatewayToken !== credentials.upstreamKey && credentials.gatewayToken !== credentials.sessionSecret, 'credentials_must_differ', 503);
  return profile;
}
export async function loadConfig(path, env = process.env) {
  let profile;
  try { profile = JSON.parse(await readFile(path, 'utf8')); } catch { throw new BridgeError('invalid_config_file', 503); }
  const auth = profile.auth ?? {};
  const credentials = { gatewayToken: env[auth.gatewayTokenEnv], upstreamKey: env[auth.upstreamKeyEnv], sessionSecret: env[auth.sessionSecretEnv] };
  validateProfile(profile, credentials);
  return { profile, credentials };
}
function sameSecret(a, b) {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function authorize(req, token, protocol) {
  const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
    ? req.headers.authorization.slice(7) : undefined;
  const key = req.headers['x-api-key'];
  ensure(protocol !== 'responses' || bearer !== undefined, 'invalid_gateway_credential', 401);
  ensure(bearer !== undefined || key !== undefined, 'invalid_gateway_credential', 401);
  if (req.headers.authorization !== undefined) ensure(sameSecret(bearer, token), 'invalid_gateway_credential', 401);
  if (key !== undefined) ensure(sameSecret(key, token), 'invalid_gateway_credential', 401);
}
function header(req, name) {
  const value = req.headers[name];
  ensure(value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 256), 'invalid_header', 400);
  return value;
}
function claudeConversationHint(body) {
  const value = body.metadata?.user_id;
  if (typeof value !== 'string' || value.length > 1024) return;
  let hint;
  try { hint = JSON.parse(value)?.session_id; } catch { hint = /_session_([0-9a-f-]{36})$/i.exec(value)?.[1]; }
  if (typeof hint === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hint)) return hint;
}
export async function readJson(req, profile, signal) {
  ensure(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''), 'unsupported_media_type', 415);
  const declared = req.headers['content-length'];
  if (declared !== undefined) ensure(/^\d+$/.test(declared) && Number(declared) <= profile.limits.requestBytes, 'request_too_large', 413);
  return new Promise((resolveBody, reject) => {
    let size = 0, chunks = [];
    const cleanup = () => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted);
      signal.removeEventListener('abort', aborted);
    };
    const fail = e => { cleanup(); chunks = []; req.resume(); reject(e); };
    const error = () => fail(new BridgeError('invalid_request', 400));
    const aborted = () => fail(new BridgeError('client_disconnected', 499));
    const timer = setTimeout(() => fail(new BridgeError('body_timeout', 408)), profile.timeouts.bodyReadMs);
    const data = chunk => {
      size += chunk.length;
      if (size > profile.limits.requestBytes) { fail(new BridgeError('request_too_large', 413)); return; }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        object(value);
        // Reject deeply nested input before recursive stringification or schema walks.
        const stack = [[value, 0]];
        while (stack.length) {
          const [node, depth] = stack.pop();
          ensure(depth <= 64, 'request_too_deep', 400);
          if (node && typeof node === 'object') for (const child of Object.values(node)) stack.push([child, depth + 1]);
        }
        resolveBody(value);
      } catch (e) { reject(e instanceof BridgeError ? e : new BridgeError('invalid_json', 400)); }
    };
    req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
function sendJson(res, status, body, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
export async function writeFrame(res, frame, signal, stallMs) {
  ensure(!res.destroyed && !res.writableEnded && !signal.aborted, 'client_disconnected', 499);
  if (res.write(frame)) return;
  await new Promise((done, fail) => {
    const cleanup = () => {
      clearTimeout(timer); res.off('drain', drain); res.off('close', close); res.off('error', close);
      signal.removeEventListener('abort', close);
    };
    const drain = () => { cleanup(); done(); };
    const close = () => { cleanup(); fail(new BridgeError('client_disconnected', 499)); };
    const timer = setTimeout(() => { cleanup(); fail(new BridgeError('downstream_stall', 504)); }, stallMs);
    res.once('drain', drain); res.once('close', close); res.once('error', close);
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted || res.destroyed) close();
  });
}
const sse = e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n';
async function raceTick(next, delay) {
  if (delay === undefined) return { kind: 'next', value: await next };
  let timer;
  try {
    return await Promise.race([next.then(value => ({ kind: 'next', value })),
      new Promise(resolveTick => { timer = setTimeout(() => resolveTick({ kind: 'tick' }), Math.max(1, delay)); })]);
  } finally { clearTimeout(timer); }
}

export function makeServer(profile, credentials, options = {}) {
  validateProfile(profile, credentials, options);
  const sessions = createSessions(credentials.sessionSecret, profile);
  const diagnostics = [];
  const admin = options.admin ? createAdmin(profile, credentials, sessions, {
    ...options.admin, diagnostics, validate: (nextProfile, nextCredentials) => validateProfile(nextProfile, nextCredentials, options),
  }) : null;
  const controllers = new Set();
  const logger = options.logger ?? (entry => process.stdout.write(JSON.stringify(entry) + '\n'));
  const server = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    const startedAt = Date.now(), requestId = randomUUID();
    const abort = new AbortController(); controllers.add(abort);
    const disconnected = () => { if (!res.writableFinished) abort.abort(new BridgeError('client_disconnected', 499)); };
    res.once('close', disconnected);
    let protocol = 'responses', lease, iterator, encoder, outcome = 'error', code;
    let metrics, traceId, inferenceRoute = false;
    const textBlocks = new Set();
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (admin && await admin(req, res, pathname)) { outcome = 'ok'; return; }
      const route = routes.get(pathname);
      inferenceRoute = ['anthropic', 'responses'].includes(route?.[1]);
      if (pathname.includes('messages') || req.headers['anthropic-version'] || req.headers['x-api-key']) protocol = 'anthropic';
      ensure(route, 'not_found', 404);
      ensure(req.method === route[0], 'method_not_allowed', 405);
      const type = route[1];
      if (type === 'health') { sendJson(res, 200, { status: 'ok', contractVersion: 'astra1-v1' }); outcome = 'ok'; return; }
      if (type === 'responses') protocol = 'responses';
      authorize(req, credentials.gatewayToken, protocol);
      if (type === 'models') {
        const names = Object.keys(profile.models);
        sendJson(res, 200, protocol === 'anthropic'
          ? { data: names.map(id => ({ id, type: 'model', display_name: id, created_at: '2026-09-15T00:00:00Z' })),
            first_id: names[0], last_id: names.at(-1), has_more: false }
          : { object: 'list', data: names.map(id => ({ id, object: 'model', created: 0, owned_by: 'commandcode' })) });
        outcome = 'ok'; return;
      }
      const body = await readJson(req, profile, abort.signal);
      if (type === 'count') {
        modelFor(profile, body.model);
        sendJson(res, 200, estimateTokens(body), { 'x-astra-token-count': 'estimate' }); outcome = 'ok'; return;
      }
      const context = { protocol, principal: 'local-gateway',
        upstreamAccount: createHash('sha256').update(credentials.upstreamKey).digest('hex'), workspaceId: profile.upstream.workspaceId,
        conversationHint: header(req, 'x-astra-conversation-id') ?? header(req, protocol === 'anthropic' ? 'x-claude-code-session-id' : 'thread-id')
          ?? (protocol === 'anthropic' ? claudeConversationHint(body) : undefined),
        agentHint: header(req, 'x-astra-agent-id') ?? header(req, 'x-claude-code-agent-id'),
        anthropicVersion: header(req, 'anthropic-version'), anthropicBeta: req.headers['anthropic-beta'] };
      const turn = protocol === 'anthropic' ? decodeAnthropic(body, context, profile) : decodeResponses(body, context, profile);
      lease = sessions.acquire(context);
      const actual = compileNative(turn, profile, lease.identity, credentials);
      traceId = actual.headers.traceparent?.split('-')[1];
      metrics = { publicModel: turn.publicModel, upstreamModel: actual.body.params.model,
        requestedEffort: turn.requestedEffort, upstreamEffort: actual.body.params.reasoning_effort ?? null,
        accountFingerprint: context.upstreamAccount.slice(0, 12),
        requestBytes: Buffer.byteLength(JSON.stringify(actual.body)), tools: turn.tools.length,
        conversationBound: lease.bound, stream: turn.stream,
        samePrefixAsPrevious: lease.observePrefix({ model: actual.body.params.model, config: actual.body.config,
          system: actual.body.params.system, tools: actual.body.params.tools }), textDeltas: 0,
        firstTextMs: null, lastTextMs: null };
      encoder = protocol === 'anthropic' ? createAnthropicEncoder(turn, profile) : createResponsesEncoder(turn, profile);
      let pending = encoder.start(), pendingBytes = 0, committed = false, preludeDeadline, lastWrite = Date.now();
      const write = async events => {
        for (const e of events) await writeFrame(res, sse(e), abort.signal, profile.timeouts.downstreamStallMs);
        lastWrite = Date.now();
      };
      const commit = async () => {
        if (committed) return;
        committed = true;
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no', 'connection': 'keep-alive' });
        await write(pending); pending = [];
      };
      iterator = generate(actual, profile, abort.signal)[Symbol.asyncIterator]();
      let next = iterator.next(), finished = false;
      while (true) {
        const delay = !turn.stream ? undefined : committed ? lastWrite + profile.timeouts.heartbeatMs - Date.now()
          : preludeDeadline === undefined ? undefined : preludeDeadline - Date.now();
        const event = await raceTick(next, delay);
        if (event.kind === 'tick') {
          if (!committed) await commit();
          else {
            await writeFrame(res, protocol === 'anthropic' ? 'event: ping\ndata: {"type":"ping"}\n\n' : ': keepalive\n\n',
              abort.signal, profile.timeouts.downstreamStallMs);
            lastWrite = Date.now();
          }
          continue;
        }
        if (event.value.done) break;
        const value = event.value.value;
        if (value.type === 'upstream-ready') {
          metrics.upstreamReadyMs ??= Date.now() - startedAt;
          if (preludeDeadline === undefined) preludeDeadline = Date.now() + profile.timeouts.preludeMs;
        } else {
          if (value.type === 'block-delta' && value.text.length) metrics.firstContentMs ??= Date.now() - startedAt;
          const frames = encoder.push(value);
          if (value.type === 'block-start' && value.kind === 'text') textBlocks.add(value.segment + ':' + value.blockId);
          if (value.type === 'block-delta' && textBlocks.has(value.segment + ':' + value.blockId) && value.text.length) {
            metrics.textDeltas++;
            metrics.firstTextMs ??= Date.now() - startedAt;
            metrics.lastTextMs = Date.now() - startedAt;
          }
          if (value.type === 'finish') {
            finished = true;
            metrics.inputTokens = value.usage.input;
            metrics.outputTokens = value.usage.output;
            metrics.reasoningTokens = value.usage.reasoning ?? null;
            metrics.cacheReadTokens = value.cache.read;
            metrics.cacheWriteTokens = value.cache.write;
            metrics.uncachedInputTokens = value.cache.uncached;
          }
          if (turn.stream) {
            if (committed) await write(frames);
            else {
              pending.push(...frames);
              pendingBytes += frames.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0);
              if ((value.type === 'block-delta' && value.text.length > 0) || value.type === 'tool-call' || value.type === 'finish'
                || pendingBytes >= profile.prelude.maxBytes || pending.length >= profile.prelude.maxEvents) await commit();
            }
          }
        }
        next = iterator.next();
      }
      ensure(finished, 'truncated_stream', 502);
      if (turn.stream) res.end(); else sendJson(res, 200, encoder.result());
      outcome = 'ok';
    } catch (error) {
      const e = safeError(abort.signal.reason ?? error); code = e.code;
      if (!res.destroyed && !res.writableEnded) {
        if (res.headersSent && encoder) {
          try {
            for (const event of encoder.fail(e)) await writeFrame(res, sse(event), abort.signal, profile.timeouts.downstreamStallMs);
            res.end();
          } catch { res.destroy(); }
        } else sendJson(res, e.status === 499 ? 400 : e.status, errorBody(protocol, e), e.retryAfter ? { 'retry-after': e.retryAfter } : {});
      }
    } finally {
      abort.abort();
      try { await iterator?.return?.(); } catch {}
      lease?.release();
      controllers.delete(abort);
      res.off('close', disconnected);
      // Allowlist only: no body, path, headers, session identifiers or raw exceptions.
      const record = { requestId, protocol, outcome, ...(code ? { code } : {}), durationMs: Date.now() - startedAt,
        ...(metrics ? { metrics } : {}) };
      if (inferenceRoute && (metrics || code)) {
        diagnostics.push({ ...record, at: new Date(startedAt).toISOString(), traceId: traceId ?? null });
        if (diagnostics.length > 100) diagnostics.shift();
      }
      try { logger(record); } catch {}
    }
  });
  server.requestTimeout = 0; // Body deadline is enforced above; inference can run for minutes.
  server.headersTimeout = 60000;
  server.timeout = 0;
  server.on('clientError', (_err, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  server.on('upgrade', (_req, socket) => { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); });
  server.shutdown = () => {
    for (const controller of controllers) controller.abort(new BridgeError('server_shutdown', 503));
    return new Promise(resolveClose => { server.close(resolveClose); server.closeIdleConnections(); });
  };
  server.sessions = sessions;
  server.diagnostics = diagnostics;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    ensure(args.length === 0 || (args.length === 2 && args[0] === '--config'), 'invalid_arguments', 400);
    const configPath = resolve(args[1] ?? 'config.local.json');
    const { profile, credentials } = await loadConfig(configPath);
    const server = makeServer(profile, credentials, { admin: {
      configPath, secretsPath: resolve(dirname(configPath), '.astra-secrets.json'),
    } });
    server.on('error', () => { process.stderr.write('Astra1: listen_failed\n'); process.exitCode = 1; });
    server.listen(profile.listen.port, profile.listen.host, () => {
      process.stdout.write('Astra1 listening on http://' + profile.listen.host + ':' + server.address().port + '\n');
    });
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (stopping) return; stopping = true;
      await server.shutdown();
    });
  } catch (error) {
    process.stderr.write('Astra1: ' + safeError(error).code + '\n');
    process.exitCode = 1;
  }
}
