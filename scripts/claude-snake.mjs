import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';
import { makeServer } from '../src/server.mjs';
import { refreshNativeConfig } from '../src/admin.mjs';
import { clientSettings } from './client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = resolve(root, 'demos/snake');
const credentials = JSON.parse(await readFile(resolve(root, '.astra-secrets.json'), 'utf8'));
const profile = JSON.parse(await readFile(resolve(root, 'config.local.json'), 'utf8'));
const expectedAccount = 'deizermonokixhtf';
const expectedModel = 'meta/muse-spark-1.3-contributor';
const who = await fetch('https://api.commandcode.ai/alpha/whoami', {
  headers: { Authorization: 'Bearer ' + credentials.upstreamKey },
  signal: AbortSignal.timeout(15000), redirect: 'error',
});
const identity = await who.json();
if (!who.ok || identity.user?.userName !== expectedAccount) throw Error('account_mismatch');
if (Object.values(profile.models).some(m => m.upstreamModel !== expectedModel)) throw Error('model_mismatch');
await mkdir(workspace, { recursive: true });
profile.listen.port = 0;
profile.upstream.workspaceId = workspace;
profile.upstream.projectSlug = 'astra-snake-demo';
await refreshNativeConfig(profile);

const report = {
  startedAt: new Date().toISOString(), account: expectedAccount, upstreamModel: expectedModel,
  client: execFileSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
  mode: 'print / stream-json / include-partial-messages', upstreamRequests: [],
  clientStreamEvents: {}, toolsCalled: {}, toolResults: 0, toolErrors: 0, partialTextDeltas: 0,
  successfulBridgeRequests: 0, bridgeErrors: [],
};
function increment(map, key) { map[key] = (map[key] ?? 0) + 1; }
// Observe the actual HTTP boundary in this test process; retain structure/counts only.
const originalRequest = https.request;
https.request = function (...args) {
  const req = originalRequest.apply(this, args);
  if (String(args[0]) !== profile.upstream.baseUrl + profile.upstream.path) return req;
  const row = {
    authMatchesVerifiedAccountKey: args[1]?.headers?.Authorization === 'Bearer ' + credentials.upstreamKey,
    nativeEvents: {}, textDeltaCount: 0, nativeToolCalls: 0,
  };
  report.upstreamRequests.push(row);
  const originalEnd = req.end;
  req.end = function (data, ...rest) {
    if (data) {
      const body = JSON.parse(String(data));
      row.model = body.params.model;
      row.stream = body.params.stream;
      row.workspaceMatchesDemo = body.config.workingDir === workspace;
    }
    return originalEnd.call(this, data, ...rest);
  };
  req.once('response', res => {
    row.status = res.statusCode;
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const originalEmit = res.emit;
    res.emit = function (event, ...values) {
      if (event === 'data') {
        pending += decoder.write(values[0]);
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
          if (line) {
            try {
              const native = JSON.parse(line);
              increment(row.nativeEvents, native.type);
              if (native.type === 'text-delta') row.textDeltaCount++;
              if (native.type === 'tool-call') row.nativeToolCalls++;
            } catch { row.observationParseError = true; }
          }
        }
        if (pending.length > profile.limits.nativeLineBytes) pending = '';
      }
      return originalEmit.call(this, event, ...values);
    };
  });
  return req;
};

const server = makeServer(profile, credentials, { logger: row => {
  if (row.outcome === 'ok') report.successfulBridgeRequests++;
  else report.bridgeErrors.push(row.code);
} });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const settings = await clientSettings('claude', 'http://127.0.0.1:' + server.address().port,
  credentials.gatewayToken, resolve(root, '.clients/claude-snake'), profile);
settings.env.CLAUDE_CODE_GIT_BASH_PATH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const prompt = 'Read BRIEF.md with Read. Then immediately use the Write tool to write index.html, and Write to write verify.mjs. Do not use Bash to create files, inspect the environment, or run setup commands. Only after both files exist, use Bash to execute exactly node verify.mjs. You are already in the correct Snake directory. Fix failures using Edit and run node verify.mjs again. The Bash shell is Git Bash on Windows. Only work in this Snake directory. Finish with a text response: SNAKE_DONE followed by 4 short sentences summarizing the game controls and actual verification results. Text output is needed so the host can measure text streaming.';
const args = [...settings.args, '--bare', '-p', prompt, '--output-format', 'stream-json', '--verbose',
  '--include-partial-messages', '--no-session-persistence', '--permission-mode', 'acceptEdits',
  '--tools', 'Read,Write,Edit,Bash', '--allowedTools', 'Read(./**)', 'Write(./**)', 'Edit(./**)',
  'Bash(node verify.mjs)', 'Bash(node --check *)',
  '--system-prompt', 'You are a coding assistant building a small self-contained Snake game. Use only the provided local tools and this workspace. Never read parent directories, credentials, config files, or unrelated user files. Do not install dependencies or use network. Follow BRIEF.md and verify actual production logic. Do not claim to have verified network streaming; the host independently measures it.'];
const child = spawn('claude', args, { cwd: workspace, env: settings.env, shell: false,
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let pending = '', finalText = '', stderrBytes = 0;
child.stderr.on('data', data => { stderrBytes += data.length; });
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
    try {
      const event = JSON.parse(line);
      if (event.type === 'stream_event') {
        increment(report.clientStreamEvents, event.event.type);
        if (event.event.delta?.type === 'text_delta') report.partialTextDeltas++;
      } else if (event.type === 'assistant') {
        for (const part of event.message.content ?? []) if (part.type === 'tool_use') {
          increment(report.toolsCalled, part.name);
          console.log(JSON.stringify({ progress: 'tool_call', tool: part.name }));
        }
      } else if (event.type === 'user') {
        for (const part of event.message.content ?? []) if (part.type === 'tool_result') {
          report.toolResults++; if (part.is_error) report.toolErrors++;
          const text = typeof part.content === 'string' ? part.content
            : Array.isArray(part.content) ? part.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : '';
          const category = /permission|denied|not allowed|not permitted|not been granted/i.test(text) ? 'permission'
            : /not found|no such file|cannot find/i.test(text) ? 'missing_file_or_command'
            : /assertion|syntaxerror|referenceerror|typeerror/i.test(text) ? 'validation'
            : part.is_error ? 'other_error' : 'ok';
          console.log(JSON.stringify({ progress: 'tool_result', error: Boolean(part.is_error), category }));
        }
      } else if (event.type === 'result') {
        report.clientIsError = event.is_error;
        report.permissionDenials = event.permission_denials?.length ?? 0;
        finalText = event.result ?? '';
      }
    } catch {}
  }
});
const timer = setTimeout(() => child.kill(), 480000);
try {
  report.exitCode = await new Promise((r, reject) => { child.once('exit', r); child.once('error', reject); });
  report.stderrPresent = stderrBytes > 0;
  report.finalMarker = finalText.includes('SNAKE_DONE');
  report.filesCreated = await Promise.all(['index.html', 'verify.mjs'].map(async name => ({
    name, bytes: await stat(resolve(workspace, name)).then(s => s.size).catch(() => 0),
  })));
  if (report.filesCreated.every(f => f.bytes > 0)) {
    const check = spawnSync(process.execPath, [resolve(workspace, 'verify.mjs')], {
      cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    report.gameCheckExitCode = check.status;
  }
  report.passed = report.exitCode === 0 && !report.clientIsError && report.finalMarker
    && report.filesCreated.every(f => f.bytes > 0) && report.partialTextDeltas > 1
    && report.toolsCalled.Read > 0 && (report.toolsCalled.Write > 0 || report.toolsCalled.Edit > 0)
    && report.toolsCalled.Bash > 0
    && report.toolResults >= 3 && report.gameCheckExitCode === 0
    && report.upstreamRequests.length >= 2 && report.upstreamRequests.every(r =>
      r.authMatchesVerifiedAccountKey && r.model === expectedModel && r.stream === true
      && r.workspaceMatchesDemo && r.status === 200)
    && report.upstreamRequests.some(r => r.textDeltaCount > 1);
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(root, 'evidence/claude-snake.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, upstreamRequests: undefined, clientStreamEvents: undefined }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  clearTimeout(timer); https.request = originalRequest; await server.shutdown();
}
