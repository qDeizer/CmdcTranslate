import { createHmac, randomUUID } from 'node:crypto';
import { ensure } from './core.mjs';

export function createSessions(secret, profile, now = Date.now) {
  ensure(typeof secret === 'string' && secret.length >= 32, 'invalid_session_secret', 503);
  const entries = new Map();
  // UUIDv8: keyed, domain-separated identities survive TTL eviction/restarts.
  // The key already isolates account/workspace/protocol/conversation/agent.
  const uuid = (key, domain) => {
    const b = createHmac('sha256', secret).update(domain + ':' + key).digest().subarray(0, 16);
    b[6] = (b[6] & 15) | 128; b[8] = (b[8] & 63) | 128;
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  let active = 0;
  return {
    acquire(context) {
      const time = now();
      for (const [key, entry] of entries) if (!entry.busy && entry.expires <= time) entries.delete(key);
      const key = context.conversationHint ? createHmac('sha256', secret).update(JSON.stringify([
        context.principal, context.upstreamAccount, context.workspaceId, context.protocol, context.conversationHint, context.agentHint ?? '',
      ])).digest('hex') : null;
      let entry = key ? entries.get(key) : null;
      // Busy comes before expiry: a slow live turn must never lose its lock.
      ensure(!entry?.busy, 'conversation_busy', 409);
      ensure(active < profile.limits.maxActiveTurns, 'capacity_exceeded', 429);
      if (!entry) {
        ensure(!key || entries.size < profile.limits.maxSessions, 'capacity_exceeded', 429);
        entry = { identity: key ? { sessionId: uuid(key, 'session'), threadId: uuid(key, 'thread') }
          : { sessionId: randomUUID(), threadId: randomUUID() }, busy: false, expires: 0 };
        if (key) entries.set(key, entry);
      }
      entry.busy = true;
      active++;
      let released = false;
      const traceId = createHmac('sha256', secret).update('trace:' + entry.identity.sessionId).digest('hex').slice(0, 32);
      return { identity: { ...entry.identity, traceId }, bound: Boolean(key), observePrefix(value) {
        const signature = createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
        const same = entry.prefix === undefined ? null : entry.prefix === signature;
        entry.prefix = signature;
        return same;
      }, release() {
        if (released) return;
        released = true;
        entry.busy = false;
        entry.expires = now() + profile.timeouts.sessionIdleTtlMs;
        active--;
      } };
    },
    stats() { return { active, entries: entries.size }; },
  };
}
