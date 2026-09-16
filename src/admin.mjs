import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { type, release, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { BridgeError, ensure, fields, object, positive, string, clientDefaults } from './core.mjs';
import catalog from '../commandcode.models.json' with { type: 'json' };

const uiFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function commandVersion(name) {
  const result = spawnSync(name, ['--version'], {
    encoding: 'utf8', windowsHide: true, timeout: 4000,
  });
  return result.status === 0
    ? { installed: true, version: (result.stdout || result.stderr).trim().split(/\r?\n/)[0].slice(0, 120) }
    : { installed: false };
}

function git(workspace, args) {
  try {
    return execFileSync('git', ['-C', workspace, ...args], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return ''; }
}

export async function refreshNativeConfig(profile) {
  const workspace = resolve(profile.upstream.workspaceId);
  const info = await stat(workspace).catch(() => null);
  ensure(info?.isDirectory(), 'invalid_workspace', 422, 'workspaceId');
  const isGitRepo = git(workspace, ['rev-parse', '--is-inside-work-tree']) === 'true';
  profile.upstream.workspaceId = workspace;
  profile.upstream.config = {
    ...profile.upstream.config,
    workingDir: workspace,
    date: new Date().toISOString().slice(0, 10),
    environment: type() + ' ' + release() + ' ' + arch(),
    structure: profile.upstream.config?.structure ?? [],
    isGitRepo,
    currentBranch: isGitRepo ? git(workspace, ['branch', '--show-current']) : '',
    mainBranch: isGitRepo ? git(workspace, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') : '',
    gitStatus: isGitRepo ? git(workspace, ['status', '--short']) : '',
    recentCommits: profile.upstream.config?.recentCommits ?? [],
  };
  return profile;
}

async function atomicJson(path, value, mode) {
  const temporary = path + '.tmp-' + process.pid + '-' + randomBytes(5).toString('hex');
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode });
  await rename(temporary, path);
}

async function readSmallJson(req) {
  ensure(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''), 'unsupported_media_type', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    ensure(size <= 65536, 'request_too_large', 413);
    chunks.push(chunk);
  }
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
  catch (error) { throw error instanceof BridgeError ? error : new BridgeError('invalid_json', 400); }
}

function aliases(profile) {
  const clients = clientDefaults(profile);
  return { codex: clients.codex.model, claude: clients.claude.model };
}

export function createAdmin(profile, credentials, sessions, options) {
  const csrf = randomBytes(32).toString('base64url');
  const clients = { claude: commandVersion('claude'), codex: commandVersion('codex') };
  let lastSavedAt = null;
  let accountCache, launchPending = false;
  const launches = [];
  const account = async (force = false) => {
    const key = credentials.upstreamKey;
    const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 12);
    if (!force && accountCache?.fingerprint === fingerprint && Date.now() - accountCache.checkedAt < 60000) return accountCache;
    try {
      const response = await fetch(profile.upstream.baseUrl + '/alpha/whoami', {
        headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      ensure(response.ok, 'account_verification_failed', 502);
      const body = await response.json();
      ensure(typeof body.user?.userName === 'string', 'account_verification_failed', 502);
      accountCache = { verified: true, userName: body.user.userName, organization: body.org?.login ?? null,
        usageUrl: 'https://commandcode.ai/' + encodeURIComponent(body.org?.login ?? body.user.userName) + '/settings/usage',
        fingerprint, checkedAt: Date.now() };
      return accountCache;
    } catch { return { verified: false, fingerprint, error: 'account_verification_failed' }; }
  };

  const same = value => {
    if (typeof value !== 'string') return false;
    const a = Buffer.from(value), b = Buffer.from(csrf);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const authorize = req => {
    ensure(same(req.headers['x-astra-admin']), 'invalid_admin_token', 403);
    const origin = req.headers.origin;
    ensure(origin === undefined || origin === 'http://' + req.headers.host, 'invalid_origin', 403);
  };
  const view = () => {
    const names = aliases(profile);
    const model = profile.models[names.codex];
    return {
      csrf,
      endpoint: 'http://' + profile.listen.host + ':' + profile.listen.port,
      apiKeyConfigured: Boolean(credentials.upstreamKey),
      activeTurns: sessions.stats().active,
      clients,
      commands: { claude: 'npm.cmd run claude', codex: 'npm.cmd run codex' },
      lastSavedAt,
      catalog, launches,
      config: {
        models: structuredClone(profile.models), clients: clientDefaults(profile), traceMode: profile.traceMode ?? 'request',
        upstreamModel: model.upstreamModel,
        codexAlias: names.codex,
        claudeAlias: names.claude,
        maxTokens: model.defaultMaxTokens,
        workspaceId: profile.upstream.workspaceId,
        projectSlug: profile.upstream.projectSlug,
        permissionMode: profile.upstream.permissionMode,
        tasteLearning: profile.upstream.tasteLearning,
      },
    };
  };
  const update = async body => {
    fields(body, ['apiKey', 'upstreamModel', 'codexAlias', 'claudeAlias', 'maxTokens',
      'workspaceId', 'projectSlug', 'permissionMode', 'tasteLearning', 'models', 'clients', 'traceMode']);
    const apiKey = body.apiKey === undefined ? undefined : string(body.apiKey, 'apiKey').trim();
    ensure(apiKey === undefined || (apiKey.length > 0 && apiKey.length <= 4096 && !/[\r\n]/.test(apiKey)), 'invalid_api_key', 422, 'apiKey');
    const workspaceId = string(body.workspaceId, 'workspaceId', true).trim();
    const projectSlug = string(body.projectSlug, 'projectSlug', true).trim();
    ensure(projectSlug.length <= 256 && /^[a-z0-9][a-z0-9._-]*$/i.test(projectSlug), 'invalid_project_slug', 422, 'projectSlug');
    ensure(['standard', 'auto-accept', 'plan'].includes(body.permissionMode), 'invalid_permission_mode', 422, 'permissionMode');
    ensure(typeof body.tasteLearning === 'boolean', 'invalid_request', 400, 'tasteLearning');
    ensure(sessions.stats().active === 0, 'configuration_busy', 409);

    const next = structuredClone(profile);
    const current = aliases(profile);
    const codexBase = profile.models[current.codex], claudeBase = profile.models[current.claude];
    next.upstream.workspaceId = workspaceId;
    next.upstream.projectSlug = projectSlug;
    next.upstream.permissionMode = body.permissionMode;
    next.upstream.tasteLearning = body.tasteLearning;
    if (body.models !== undefined) {
      object(body.models, 'models');
      for (const model of Object.values(body.models)) {
        fields(model, ['upstreamModel', 'defaultMaxTokens', 'maxOutputTokens', 'vision', 'reasoningText', 'efforts',
          'clientToolSearch', 'temperatureRange', 'effortMap'], 'models');
        ensure(typeof model.upstreamModel === 'string' && model.upstreamModel.trim() === model.upstreamModel
          && model.upstreamModel.length <= 256 && !/[\r\n]/.test(model.upstreamModel), 'invalid_upstream_model', 422);
        ensure(positive(model.defaultMaxTokens, 'maxTokens') <= 1000000, 'invalid_max_tokens', 422);
      }
      next.models = structuredClone(body.models);
      fields(body.clients, ['claude', 'codex'], 'clients');
      for (const client of Object.values(body.clients)) fields(client, ['model', 'effort'], 'clients');
      next.clients = structuredClone(body.clients);
    } else {
      const upstreamModel = string(body.upstreamModel, 'upstreamModel', true).trim();
      const codexAlias = string(body.codexAlias, 'codexAlias', true).trim();
      const claudeAlias = string(body.claudeAlias, 'claudeAlias', true).trim();
      ensure(codexAlias !== claudeAlias, 'invalid_model_alias', 422);
      ensure(upstreamModel.length <= 256 && !/[\r\n]/.test(upstreamModel), 'invalid_upstream_model', 422);
      const maxTokens = positive(body.maxTokens, 'maxTokens');
      ensure(maxTokens <= 1000000, 'invalid_max_tokens', 422);
      next.models = { [codexAlias]: { ...codexBase, upstreamModel, defaultMaxTokens: maxTokens },
        [claudeAlias]: { ...claudeBase, upstreamModel, defaultMaxTokens: maxTokens } };
      if (next.clients) { next.clients.codex.model = codexAlias; next.clients.claude.model = claudeAlias; }
    }
    if (body.traceMode !== undefined) next.traceMode = body.traceMode;
    await refreshNativeConfig(next);
    const nextCredentials = { ...credentials, ...(apiKey ? { upstreamKey: apiKey } : {}) };
    options.validate(next, nextCredentials);

    const secrets = await readFile(options.secretsPath, 'utf8').then(JSON.parse).catch(() => ({
      gatewayToken: credentials.gatewayToken,
      sessionSecret: credentials.sessionSecret,
    }));
    secrets.upstreamKey = nextCredentials.upstreamKey;
    await atomicJson(options.secretsPath, secrets, 0o600);
    await atomicJson(options.configPath, next, 0o600);
    Object.keys(profile).forEach(key => delete profile[key]);
    Object.assign(profile, next);
    Object.assign(credentials, nextCredentials);
    lastSavedAt = new Date().toISOString();
    return view();
  };
  const testConnection = async () => {
    ensure(sessions.stats().active === 0, 'configuration_busy', 409);
    const name = aliases(profile).codex, started = Date.now();
    const response = await fetch('http://' + profile.listen.host + ':' + profile.listen.port + '/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + credentials.gatewayToken,
        'x-astra-conversation-id': 'ui-test-' + randomBytes(8).toString('hex'),
      },
      body: JSON.stringify({ model: name, input: 'Reply only ASTRA_OK.', max_output_tokens: 1024 }),
      signal: AbortSignal.timeout(120000),
    });
    const result = await response.json();
    const text = result.output?.flatMap(item => item.content ?? [])
      .filter(part => part.type === 'output_text').map(part => part.text).join('').trim();
    ensure(response.ok && text === 'ASTRA_OK', result.error?.code ?? 'connection_test_failed', 502);
    return { ok: true, latencyMs: Date.now() - started, model: name };
  };

  return async function handle(req, res, pathname) {
    if (uiFiles.has(pathname) || pathname.startsWith('/admin/')) {
      ensure(['127.0.0.1:' + req.socket.localPort, 'localhost:' + req.socket.localPort].includes(req.headers.host), 'invalid_host', 403);
    }
    const file = uiFiles.get(pathname);
    if (file && req.method === 'GET') {
      const content = await readFile(new URL('../ui/' + file[0], import.meta.url));
      res.writeHead(200, {
        'content-type': file[1],
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      res.end(content);
      return true;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return true; }
    if (pathname === '/admin/config' && req.method === 'GET') { sendJson(res, 200, view()); return true; }
    if (pathname === '/admin/account' && req.method === 'GET') {
      authorize(req); sendJson(res, 200, await account()); return true;
    }
    if (pathname === '/admin/models' && req.method === 'GET') {
      authorize(req);
      const verified = await account(true);
      ensure(verified.verified, 'account_verification_failed', 502);
      sendJson(res, 200, { account: verified, catalog, checkedAt: new Date().toISOString(),
        source: 'command-code-cli-' + profile.upstream.cliVersion });
      return true;
    }
    if (pathname === '/admin/requests' && req.method === 'GET') {
      authorize(req); sendJson(res, 200, { activeTurns: sessions.stats().active, requests: options.diagnostics ?? [] }); return true;
    }
    if (pathname === '/admin/launch' && req.method === 'POST') {
      authorize(req);
      const body = fields(await readSmallJson(req), ['client']);
      ensure(['claude', 'codex'].includes(body.client) && clients[body.client].installed, 'client_not_found', 422);
      ensure(!launchPending, 'launch_busy', 409);
      launchPending = true;
      try {
        const { launchWindow } = await import('../scripts/client.mjs');
        const launched = await launchWindow(body.client);
        launches.push({ ...launched, at: new Date().toISOString() });
        if (launches.length > 10) launches.shift();
        sendJson(res, 200, launched);
      } finally { launchPending = false; }
      return true;
    }
    if (pathname === '/admin/config' && req.method === 'POST') {
      authorize(req);
      sendJson(res, 200, await update(await readSmallJson(req)));
      return true;
    }
    if (pathname === '/admin/test' && req.method === 'POST') {
      authorize(req);
      await readSmallJson(req);
      sendJson(res, 200, await testConnection());
      return true;
    }
    return false;
  };
}
