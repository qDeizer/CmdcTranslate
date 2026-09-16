import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { withBridge, textEvents, parseSse } from './helper.mjs';

test('F35 310 seconds of native silence with real timers', { timeout: 340000 }, async () => {
  const started = Date.now();
  await withBridge(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write('{"type":"start"}\n');
    await sleep(310000);
    res.end(textEvents.slice(1).map(e => JSON.stringify(e)).join('\n') + '\n');
  }, async ({ send }) => {
    const response = await send('responses', { stream: true });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert(text.split(': keepalive').length - 1 >= 24);
    assert.equal(parseSse(text).at(-1).type, 'response.completed');
    assert(Date.now() - started >= 310000);
  }, p => {
    p.timeouts.upstreamIdleMs = 600000; p.timeouts.heartbeatMs = 12000;
    p.timeouts.terminalDrainMs = 5000; p.timeouts.preludeMs = 1000;
  });
});
