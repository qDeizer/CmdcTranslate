import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepare } from './run.mjs';
import { makeServer } from '../src/server.mjs';
import { clientSettings } from './client.mjs';

const client = process.argv[2];
if (!['claude', 'codex'].includes(client)) throw Error('Use claude or codex');
const { profile, credentials } = await prepare();
const workspace = resolve('evidence/smoke-workspace');
profile.upstream.workspaceId = workspace;
profile.upstream.config.workingDir = workspace;
await mkdir(workspace, { recursive: true });
const clientHome = resolve('evidence/private/' + client + '-home');
await mkdir(clientHome, { recursive: true });
await writeFile(resolve(workspace, 'input.txt'), 'ASTRA_TOOL_OK\n');
await copyFile(resolve('fixtures/red.png'), resolve(workspace, 'red.png'));
const diagnostics = [];
let sawToolError = false, sawToolToken = false, sawToolImage = false;
const server = makeServer(profile, credentials, { logger: row => diagnostics.push(row) });
server.prependListener('request', req => {
  if (req.method !== 'POST') return;
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const b = JSON.parse(Buffer.concat(chunks).toString());
      const results = client === 'claude'
        ? b.messages?.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'tool_result') : []) ?? []
        : Array.isArray(b.input) ? b.input.filter(i => i.type === 'function_call_output') : [];
      for (const result of results) {
        const output = JSON.stringify(result.content ?? result.output);
        sawToolToken ||= output.includes('ASTRA_TOOL_OK');
        sawToolImage ||= /"type":"(?:input_image|image)"/.test(output);
        sawToolError ||= result.is_error === true || /does not exist|cannot find path|exit code: [1-9]|exit code [1-9]/i.test(output);
      }
      // Only protocol structure from this synthetic smoke run; never prompt/auth/raw payload.
      diagnostics.push({ path: req.url, bodyKeys: Object.keys(b),
        roles: b.messages?.map(m => m.role),
        reasoning: b.reasoning, thinking: b.thinking, output_config: b.output_config, text: b.text, include: b.include,
        tools: b.tools?.map(t => ({ type: t.type, name: t.name, keys: Object.keys(t), format: t.format?.type })),
        messageParts: b.messages?.flatMap(m => Array.isArray(m.content) ? m.content.map(p => ({ type: p.type, keys: Object.keys(p), cache: p.cache_control })) : []),
        inputItems: Array.isArray(b.input) ? b.input.map(i => ({ type: i.type, role: i.role, keys: Object.keys(i),
          outputParts: Array.isArray(i.output) ? i.output.map(p => ({ type: p.type, keys: Object.keys(p), detail: p.detail })) : undefined })) : [],
      });
    } catch {}
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const errorCase = process.argv[3] === 'error';
const imageCase = process.argv[3] === 'image';
const inputPath = resolve(workspace, 'input.txt'), missingPath = resolve(workspace, 'missing.txt');
const prompt = imageCase ? 'Use a tool to view the image at ' + resolve(workspace, 'red.png') +
  '. Reply with only the dominant color in uppercase English. Do not inspect any other file or modify any files.' :
  (errorCase ? 'First use a tool to read ' + missingPath + '. It does not exist. After that tool returns an error, ' : '') +
  'use a tool to read ' + inputPath + '. Use these exact absolute Windows paths. Then reply with only the exact token from input.txt. Do not modify any files or read any other files.';
const settings = await clientSettings(client, base, credentials.gatewayToken, clientHome, profile);
const args = client === 'claude'
  ? [...settings.args, '--bare', '-p', prompt, '--output-format', 'json',
    '--tools', 'Read', '--allowedTools', 'Read(./input.txt)', 'Read(./missing.txt)', 'Read(./red.png)', '--no-session-persistence',
    '--system-prompt', 'You are a read-only integration test. Follow the user request.']
  : ['exec', ...settings.args, '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only',
    '-C', workspace, '-c', 'features.multi_agent=false', '--json', prompt];
const child = spawn(client, args, { cwd: workspace, windowsHide: true, shell: false,
  env: settings.env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', x => { stdout += x; });
child.stderr.on('data', x => { stderr += x; });
const timeout = setTimeout(() => child.kill(), 180000);
try {
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  const output = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const last = output.at(-1);
  const finalText = client === 'claude' ? last?.result
    : output.filter(x => x.type === 'item.completed' && x.item?.type === 'agent_message').at(-1)?.item.text;
  const report = {
    date: new Date().toISOString(), client,
    version: execFileSync(client, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
    case: imageCase ? 'tool-image' : errorCase ? 'error-then-read' : 'read', exitCode,
    exactFinal: finalText?.trim() === (imageCase ? 'RED' : 'ASTRA_TOOL_OK'),
    sawToolError, sawToolToken, sawToolImage,
    resultFields: last ? Object.keys(last) : [], stderrPresent: stderr.length > 0,
    permissionDenialCount: last?.permission_denials?.length,
    successfulRequests: diagnostics.filter(x => x.outcome === 'ok').length,
    configSha256: createHash('sha256').update(JSON.stringify(profile)).digest('hex'), diagnostics,
  };
  report.passed = exitCode === 0 && report.exactFinal && (imageCase ? sawToolImage : sawToolToken)
    && report.successfulRequests >= (errorCase ? 3 : 2) && (!errorCase || sawToolError);
  await writeFile(resolve('evidence', client + '-' + report.case + '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, diagnostics: undefined }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally { clearTimeout(timeout); await server.shutdown(); }
