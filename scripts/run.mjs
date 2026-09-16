import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { BridgeError, ensure } from '../src/core.mjs';
import { validateProfile } from '../src/server.mjs';
import { refreshNativeConfig } from '../src/admin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function prepare(env = process.env, { refresh = true } = {}) {
  const configPath = resolve(root, 'config.local.json');
  let profile;
  try { profile = await readJson(configPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new BridgeError('invalid_config_file', 503);
    profile = await readJson(resolve(root, 'config.example.json'));
    // The example also pins historical golden fixtures; new installs use the verified UI defaults.
    for (const model of Object.values(profile.models)) {
      model.efforts = ['low', 'medium', 'high', 'xhigh'];
      model.effortMap = { default: 'low', none: 'low', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };
    }
    const names = Object.keys(profile.models);
    profile.clients = { codex: { model: names[0], effort: 'low' }, claude: { model: names[1] ?? names[0], effort: 'low' } };
    profile.traceMode = 'conversation';
    profile.upstream.workspaceId = root.replace(/[\\/]$/, '');
    profile.upstream.projectSlug = profile.upstream.workspaceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await writeFile(configPath, JSON.stringify(profile, null, 2) + '\n', { flag: 'wx' });
  }
  if (refresh) {
    await refreshNativeConfig(profile);
    await writeFile(configPath, JSON.stringify(profile, null, 2) + '\n');
  }
  const secretsPath = resolve(root, '.astra-secrets.json');
  let secrets;
  try { secrets = await readJson(secretsPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new BridgeError('invalid_local_secrets', 503);
    secrets = { gatewayToken: randomBytes(32).toString('base64url'), sessionSecret: randomBytes(32).toString('base64url') };
    await writeFile(secretsPath, JSON.stringify(secrets) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const credentials = {
    gatewayToken: env[profile.auth.gatewayTokenEnv] ?? secrets.gatewayToken,
    sessionSecret: env[profile.auth.sessionSecretEnv] ?? secrets.sessionSecret,
    upstreamKey: secrets.upstreamKey ?? env[profile.auth.upstreamKeyEnv],
  };
  if (!credentials.upstreamKey) {
    try { credentials.upstreamKey = (await readJson(resolve(homedir(), '.commandcode/auth.json'))).apiKey; }
    catch { throw new BridgeError('missing_upstream_key', 503); }
  }
  if (!secrets.upstreamKey) {
    secrets.upstreamKey = credentials.upstreamKey;
    await writeFile(secretsPath, JSON.stringify(secrets, null, 2) + '\n', { mode: 0o600 });
  }
  validateProfile(profile, credentials);
  return { profile, credentials, configPath };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    ensure(process.argv.length === 2, 'invalid_arguments', 400);
    const { profile, credentials, configPath } = await prepare();
    const child = spawn(process.execPath, [resolve(root, 'src/server.mjs'), '--config', configPath], {
      cwd: root, windowsHide: true, stdio: 'inherit', env: {
        ...process.env, [profile.auth.gatewayTokenEnv]: credentials.gatewayToken,
        [profile.auth.sessionSecretEnv]: credentials.sessionSecret, [profile.auth.upstreamKeyEnv]: credentials.upstreamKey,
      },
    });
    child.on('error', () => { process.stderr.write('Astra1: startup_failed\n'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  } catch (error) {
    process.stderr.write('Astra1: ' + (error instanceof BridgeError ? error.code : 'startup_failed') + '\n');
    process.exitCode = 1;
  }
}
