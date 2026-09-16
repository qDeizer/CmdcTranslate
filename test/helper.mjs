import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { makeServer } from '../src/server.mjs';
export const example = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url)));
export const credentials = { gatewayToken: 'synthetic-gateway-'.repeat(3), sessionSecret: 'synthetic-session-'.repeat(3), upstreamKey: 'synthetic-upstream-secret' };
export const usage = { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 10 }, outputTokenDetails: { reasoningTokens: 5 } };
export const textEvents = [
  { type: 'start' }, { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', text: 'Merhaba 🌿' }, { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: 'stop', totalUsage: usage },
  { type: 'provider-metadata', providerMetadata: {} },
];
export const writeNative = (res, events) => {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  res.end(events.map(e => JSON.stringify(e)).join('\n') + '\n');
};
export async function withBridge(handler, action, customize = () => {}, serverOptions = {}) {
  const calls = [], logs = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    calls.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
    try { await handler(req, res, calls); } catch { if (!res.destroyed) res.destroy(); }
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const profile = structuredClone(example);
  const localCredentials = { ...credentials };
  Object.assign(profile.upstream, { baseUrl: 'http://127.0.0.1:' + upstream.address().port, projectSlug: 'synthetic-project', workspaceId: 'synthetic-workspace' });
  profile.upstream.config = { workingDir: 'C:/synthetic-workspace', date: '2026-09-15', environment: 'synthetic-test',
    structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] };
  profile.listen.port = 0;
  Object.assign(profile.timeouts, { preludeMs: 20, heartbeatMs: 40, terminalDrainMs: 150, upstreamHeadersMs: 500, upstreamIdleMs: 500, downstreamStallMs: 150 });
  customize(profile);
  const server = makeServer(profile, localCredentials, {
    allowTestUpstream: true, logger: e => logs.push(e), ...serverOptions,
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  const send = (protocol, body, options = {}) => fetch(url + (protocol === 'anthropic' ? '/v1/messages' : '/v1/responses'), {
    method: 'POST', ...options, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localCredentials.gatewayToken, ...options.headers },
    body: JSON.stringify({ model: 'astra-muse', ...(protocol === 'anthropic' ? { max_tokens: 100, messages: [{ role: 'user', content: 'synthetic' }] } : { input: 'synthetic', store: false }), ...body }),
  });
  try { return await action({ send, url, calls, logs, server, profile }); }
  finally {
    await server.shutdown();
    await new Promise(r => { upstream.close(r); upstream.closeAllConnections(); });
  }
}
export function parseSse(text) {
  return text.split('\n\n').filter(x => x.includes('data: ')).map(frame => JSON.parse(frame.split('\n').find(x => x.startsWith('data: ')).slice(6)));
}
