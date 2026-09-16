import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepare } from './run.mjs';
import { clientDefaults } from '../src/core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function aliases(profile) {
  const c = clientDefaults(profile);
  return { codex: c.codex.model, claude: c.claude.model };
}

export async function clientSettings(client, base, token, home, profile) {
  await mkdir(home, { recursive: true });
  const models = aliases(profile);
  const defaults = clientDefaults(profile);
  const env = { ...process.env };
  // A client launched from another agent must not inherit that agent's task identity.
  for (const key of Object.keys(env)) if (/^(CODEX_|ANTHROPIC_|CLAUDE_CODE_)/.test(key)) delete env[key];
  if (client === 'claude') {
    const settingsPath = resolve(home, 'astra-settings.json');
    const settings = { availableModels: Object.keys(profile.models),
      modelPicker: { replaceBuiltInOptions: true, options: Object.entries(profile.models).map(([model, route]) =>
        ({ model, label: model, description: 'Command Code: ' + route.upstreamModel })) }, env: {
      ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: token,
      ...(process.platform === 'win32' ? { ANTHROPIC_CUSTOM_HEADERS: 'x-astra-text-blocks: paragraphs' } : {}),
      ANTHROPIC_MODEL: models.claude, CLAUDE_CODE_DISABLE_THINKING: '1',
      ANTHROPIC_DEFAULT_MODEL: models.claude,
      ANTHROPIC_DEFAULT_OPUS_MODEL: models.claude, ANTHROPIC_DEFAULT_SONNET_MODEL: models.claude,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: models.claude, ANTHROPIC_SMALL_FAST_MODEL: models.claude,
      ANTHROPIC_DEFAULT_FABLE_MODEL: models.claude,
      CLAUDE_CODE_EFFORT_LEVEL: defaults.claude.effort,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      // Interactive title generation uses JSON-schema output unavailable on this native wire.
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    } };
    await writeFile(settingsPath, JSON.stringify(settings) + '\n', { mode: 0o600 });
    return { env: { ...env, CLAUDE_CONFIG_DIR: home, ...settings.env },
      args: ['--model', models.claude, '--settings', settingsPath, '--setting-sources', 'project'] };
  }
  if (client !== 'codex') throw Error('Choose claude or codex');
  const catalog = JSON.parse(await readFile(resolve(root, 'codex.models.json'), 'utf8'));
  const template = catalog.models[0];
  catalog.models = Object.entries(profile.models).map(([name, model]) => ({ ...template,
    slug: name, display_name: name + ' → ' + model.upstreamModel,
    supported_reasoning_levels: (model.effortMap ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
      .filter(e => model.effortMap[e] !== 'reject') : model.efforts).map(e => ({ effort: e,
        description: 'Command Code: ' + (model.effortMap?.[e] ?? e) })),
    default_reasoning_level: model.effortMap?.[defaults.codex.effort] === 'reject'
      ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].find(e => model.effortMap[e] !== 'reject')
      : defaults.codex.effort,
    input_modalities: model.vision ? ['text', 'image'] : ['text'],
  }));
  const catalogPath = resolve(home, 'models.json');
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  return { env: { ...env, CODEX_HOME: home, ASTRA_GATEWAY_TOKEN: token },
    args: [
      '-m', models.codex,
      '-c', 'model_provider="astra1"',
      '-c', 'model_providers.astra1.name="Astra1"',
      '-c', 'model_providers.astra1.base_url="' + base + '/v1"',
      '-c', 'model_providers.astra1.env_key="ASTRA_GATEWAY_TOKEN"',
      '-c', 'model_providers.astra1.wire_api="responses"',
      '-c', 'model_providers.astra1.supports_websockets=false',
      '-c', 'model_providers.astra1.request_max_retries=0',
      '-c', 'model_providers.astra1.stream_max_retries=0',
      '-c', 'model_supports_reasoning_summaries=true',
      '-c', 'model_reasoning_summary="none"',
      '-c', 'model_reasoning_effort="' + defaults.codex.effort + '"',
      '-c', 'model_catalog_json="' + catalogPath.replaceAll('\\', '/') + '"',
      '-c', 'web_search="disabled"',
      '-c', 'features.apps=false',
      '-c', 'windows.sandbox="unelevated"',
    ] };
}

export async function launchWindow(client) {
  if (!['claude', 'codex'].includes(client) || process.platform !== 'win32') throw Error('unsupported_launcher');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    resolve(root, 'scripts/launch-window.ps1'), '-Client', client, '-Root', root, '-Node', process.execPath],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.resume();
  const status = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
  if (status !== 0 || !/^\s*\d+\s*$/.test(stdout)) throw Error('client_start_failed');
  return { client, pid: Number(stdout), state: 'window_started' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const client = process.argv[2], userArgs = process.argv.slice(3);
    const { profile, credentials } = await prepare(process.env, { refresh: false });
    const base = 'http://' + profile.listen.host + ':' + profile.listen.port;
    const health = await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) });
    if (!health.ok || (await health.json()).contractVersion !== 'astra1-v1') throw Error('bridge_unavailable');
    const settings = await clientSettings(client, base, credentials.gatewayToken, resolve(root, '.clients', client), profile);
    // Codex subcommands accept the same config options after the subcommand.
    const command = client === 'codex' && ['exec', 'resume', 'review'].includes(userArgs[0]) ? [userArgs.shift()] : [];
    const child = spawn(client, [...command, ...settings.args, ...userArgs], {
      cwd: profile.upstream.workspaceId, env: settings.env, shell: false, windowsHide: true, stdio: 'inherit',
    });
    child.on('error', () => { process.stderr.write('Astra1: client_not_found\n'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  } catch {
    process.stderr.write('Astra1: client_start_failed; start the bridge with npm start and check the client executable.\n');
    process.exitCode = 1;
  }
}
