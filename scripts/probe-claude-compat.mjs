// One live, isolated Claude compatibility probe. Evidence intentionally omits body text, credentials and IDs.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { makeServer } from '../src/server.mjs';
import { decodeAnthropic } from '../src/anthropic.mjs';
import { clientSettings } from './client.mjs';
import { prepare } from './run.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowedTop = new Set(['model', 'messages', 'max_tokens', 'stream', 'system', 'tools', 'tool_choice', 'temperature', 'thinking', 'output_config', 'metadata', 'stop_sequences']);
const safeShape = body => {
  const output = body?.output_config;
  const format = output?.format;
  return {
    topLevelAllowed: body && Object.keys(body).every(key => allowedTop.has(key)),
    topLevelKeyCount: body && typeof body === 'object' ? Object.keys(body).length : null,
    hasOutputConfig: Boolean(output && typeof output === 'object'),
    outputConfigHasEffort: Boolean(output && Object.hasOwn(output, 'effort')),
    outputConfigHasFormat: Boolean(output && Object.hasOwn(output, 'format')),
    outputFormatType: typeof format?.type === 'string' ? format.type : null,
    hasTools: Array.isArray(body?.tools) && body.tools.length > 0,
    toolCount: Array.isArray(body?.tools) ? body.tools.length : null,
    messageCount: Array.isArray(body?.messages) ? body.messages.length : null,
  };
};
const listen = server => new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const exit = child => new Promise(resolveExit => {
  const timer = setTimeout(() => child.kill(), 180000);
  child.once('error', () => { clearTimeout(timer); resolveExit({ exitCode: null, spawnError: true }); });
  child.once('exit', exitCode => { clearTimeout(timer); resolveExit({ exitCode, spawnError: false }); });
});

const { profile, credentials } = await prepare(process.env, { refresh: false });
profile.listen.port = 0;
const requests = [];
const server = makeServer(profile, credentials, { logger: () => {} });
server.prependListener('request', (req) => {
  if (req.method !== 'POST' || !/^\/v1\/(?:messages|v1\/messages)$/.test(new URL(req.url, 'http://localhost').pathname)) return;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.once('end', () => {
    let body, decoded;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); decodeAnthropic(body, {}, profile); decoded = { code: null, param: null }; }
    catch (error) { decoded = { code: error?.code ?? 'invalid_json', param: error?.param ?? null }; }
    requests.push({ route: new URL(req.url, 'http://localhost').pathname, ...safeShape(body), decoder: decoded });
  });
});
const privateDir = resolve(root, 'evidence/private');
await mkdir(privateDir, { recursive: true });
const home = await mkdtemp(join(privateDir, 'claude-compat-'));
try {
  await listen(server);
  const base = 'http://127.0.0.1:' + server.address().port;
  const settings = await clientSettings('claude', base, credentials.gatewayToken, home, profile);
  const fixture = join(home, 'probe.txt');
  await writeFile(fixture, 'ASTRA_COMPAT_FIXTURE\n', { mode: 0o600 });
  const child = spawn('claude', [...settings.args, '-p', 'Read the file named probe.txt and reply with its exact single line.'], {
    cwd: home, env: settings.env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], shell: false,
  });
  const client = await exit(child);
  await new Promise(resolveWait => setTimeout(resolveWait, 100));
  const evidence = {
    date: new Date().toISOString(),
    launcher: 'normal-settings-non-bare',
    client,
    observedRequestCount: requests.length,
    requests,
    bridgeDiagnostics: server.diagnostics.map(row => ({ protocol: row.protocol, outcome: row.outcome, code: row.code ?? null, durationMs: row.durationMs })),
    note: 'No request content, credential, session/thread/trace identifier, model identifier, or stdout is retained.',
  };
  await writeFile(resolve(root, 'evidence', 'claude-compat.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
} finally {
  await server.shutdown();
  await rm(home, { recursive: true, force: true });
}
