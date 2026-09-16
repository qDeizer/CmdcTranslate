import { isDeepStrictEqual } from 'node:util';
import http from 'node:http';
import https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { BridgeError, ensure, validateNativeConfig, argumentsObject, modelFor, normalizeUsage, addUsage } from './core.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wireName = name => name === 'tool_search' ? 'search_tools' : name;
const nativeName = tool => tool.namespace
  ? 'ns_' + createHash('sha256').update(tool.namespace + '\0' + tool.name).digest('hex').slice(0, 40)
  : wireName(tool.name);

export function compileNative(turn, profile, identity, credentials) {
  const model = modelFor(profile, turn.publicModel), u = profile.upstream;
  ensure(typeof credentials.upstreamKey === 'string' && credentials.upstreamKey.length > 0, 'missing_upstream_key', 503);
  ensure(UUID.test(identity.sessionId), 'invalid_native_identity', 503);
  const toolsByWireName = new Map();
  const tools = turn.tools.map(tool => {
    const name = nativeName(tool);
    ensure(!toolsByWireName.has(name), 'tool_name_collision');
    toolsByWireName.set(name, { clientName: tool.name, wireName: name, kind: tool.kind, schema: tool.schema,
      ...(tool.namespace ? { namespace: tool.namespace } : {}) });
    return { name, ...(tool.description !== undefined ? { description: tool.description } : {}), input_schema: tool.schema };
  });
  let system = structuredClone(turn.system);
  const appendSystem = text => {
    if (system.kind !== 'sections') system = { kind: 'sections', sections: system.kind === 'string' ? [{ text: system.text, cache: false }] : [] };
    system.sections.push({ text, cache: false });
  };
  const messages = [], calls = new Map(), results = new Set();
  for (const message of turn.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      ensure(message.parts.every(p => p.type === 'text'), 'unsupported_system');
      appendSystem(message.parts.map(p => p.text).join('\n'));
      continue;
    }
    if (message.role === 'assistant') {
      const content = [];
      for (const part of message.parts) {
        if (part.type === 'text') content.push({ type: 'text', text: part.text });
        else if (part.type === 'reasoning') content.push({ type: 'reasoning', text: part.text });
        else if (part.type === 'tool-call') {
          if (part.owner === 'provider') continue;
          ensure(!calls.has(part.callId), 'duplicate_call_id');
          calls.set(part.callId, { name: nativeName(part), kind: part.kind });
          content.push({ type: 'tool-call', toolCallId: part.callId, toolName: nativeName(part), input: argumentsObject(part.input) });
        } else throw new BridgeError('unsupported_assistant_part');
      }
      messages.push({ role: 'assistant', content });
      continue;
    }
    ensure(['user', 'tool'].includes(message.role), 'unsupported_role');
    const toolParts = [], userParts = [];
    for (const part of message.parts) {
      if (part.type === 'tool-result' || part.type === 'tool-search-result') {
        const call = calls.get(part.callId);
        ensure(call, 'orphan_tool_result');
        ensure(!results.has(part.callId), 'duplicate_tool_result');
        results.add(part.callId);
        let value;
        if (part.type === 'tool-search-result') {
          ensure(call.kind === 'tool_search', 'tool_kind_mismatch');
          value = JSON.stringify({ status: part.status, execution: part.execution, tools: part.tools });
        } else {
          value = part.parts.filter(p => p.type === 'text').map(p => p.text).join('\n'); // is_error text remains unchanged.
          // Native CLI orchestration promotes tool media into the following user message.
          for (const image of part.parts.filter(p => p.type === 'image')) {
            userParts.push({ type: 'image', image: 'data:' + image.mediaType + ';base64,' + image.data, mimeType: image.mediaType });
          }
        }
        toolParts.push({ type: 'tool-result', toolCallId: part.callId, toolName: call.name, output: { type: 'text', value } });
      } else if (part.type === 'text') userParts.push({ type: 'text', text: part.text });
      else if (part.type === 'image') userParts.push({ type: 'image', image: 'data:' + part.mediaType + ';base64,' + part.data, mimeType: part.mediaType });
      else throw new BridgeError('unsupported_user_part');
    }
    // Native 1.54.0 groups tool results before the user's text/images.
    if (toolParts.length) messages.push({ role: 'tool', content: toolParts });
    if (userParts.length) messages.push({ role: 'user', content: userParts });
  }
  ensure([...calls.keys()].every(id => results.has(id)), 'dangling_tool_call');
  const params = { model: model.upstreamModel, messages, tools };
  if (system.kind === 'string') params.system = system.text;
  if (system.kind === 'sections') params.system = system.sections.map((s, i) => ({
    type: 'text', text: s.text + (i < system.sections.length - 1 ? '\n' : ''),
    ...(s.cache ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
  params.max_tokens = turn.maxTokens ?? model.defaultMaxTokens;
  params.stream = true;
  if (turn.temperature !== undefined) params.temperature = turn.temperature;
  if (turn.reasoningEffort !== undefined) params.reasoning_effort = turn.reasoningEffort;
  const body = {
    config: validateNativeConfig(u.config), memory: null, taste: null, skills: null,
    permissionMode: u.permissionMode === 'bypass' ? 'auto-accept' : ['auto-accept', 'plan'].includes(u.permissionMode) ? u.permissionMode : 'standard',
    ...(u.includeThreadId && UUID.test(identity.threadId) ? { threadId: identity.threadId } : {}),
    ...(u.mode !== undefined ? { mode: u.mode } : {}),
    ...(u.promptCache !== undefined ? { promptCache: u.promptCache } : {}), params,
  };
  const headers = {
    ...(profile.traceMode ? { traceparent: '00-' + (profile.traceMode === 'conversation' && /^[a-f0-9]{32}$/.test(identity.traceId ?? '')
      ? identity.traceId : randomBytes(16).toString('hex')) + '-' + randomBytes(8).toString('hex') + '-01' } : {}),
    'Content-Type': 'application/json', 'User-Agent': 'cli', 'x-command-code-version': u.cliVersion,
    'x-cli-environment': u.cliEnvironment, 'x-project-slug': u.projectSlug,
    'x-taste-learning': String(u.tasteLearning), 'x-session-id': identity.sessionId,
    Authorization: 'Bearer ' + credentials.upstreamKey,
  };
  return { method: 'POST', url: u.baseUrl + u.path, headers, body, toolsByWireName };
}

export async function* parseNativeLines(source, maxLineBytes = 8388608) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  const parse = line => {
    ensure(Buffer.byteLength(line) <= maxLineBytes, 'native_line_too_large', 502);
    let event;
    try { event = JSON.parse(line); } catch { throw new BridgeError('invalid_native_json', 502); }
    ensure(event && !Array.isArray(event) && typeof event === 'object' && typeof event.type === 'string', 'invalid_native_event', 502);
    return event;
  };
  for await (const chunk of source) {
    try { pending += decoder.decode(chunk, { stream: true }); }
    catch { throw new BridgeError('invalid_native_utf8', 502); }
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (line.trim()) yield parse(line);
    }
    ensure(Buffer.byteLength(pending) <= maxLineBytes, 'native_line_too_large', 502);
  }
  try { pending += decoder.decode(); } catch { throw new BridgeError('invalid_native_utf8', 502); }
  if (pending.trim()) yield parse(pending);
}

export class NativeReducer {
  constructor(request, profile, segment = 0, seenCalls = new Set()) {
    this.request = request; this.profile = profile; this.segment = segment; this.seenCalls = seenCalls;
    this.blocks = new Map(); this.tools = new Map(); this.providerCalls = new Set();
    this.metadata = {}; this.finishEvent = null; this.visible = false; this.clientCalls = 0; this.bytes = 0;
  }
  push(e) {
    this.bytes += Buffer.byteLength(JSON.stringify(e));
    ensure(this.bytes <= this.profile.limits.turnOutputBytes, 'turn_output_too_large', 502);
    ensure(!this.finishEvent || e.type === 'provider-metadata', 'late_native_event', 502);
    const event = x => ({ ...x, segment: this.segment });
    if (['start', 'start-step', 'finish-step'].includes(e.type)) return [];
    if (e.type === 'provider-metadata') {
      ensure(e.providerMetadata && typeof e.providerMetadata === 'object', 'invalid_provider_metadata', 502);
      this.metadata = { ...this.metadata, ...e.providerMetadata };
      return [];
    }
    if (e.type === 'error' || e.type === 'abort') {
      const code = /premium_credits_exhausted|model_not_in_plan|insufficient credits/i.test(JSON.stringify(e))
        ? 'upstream_entitlement' : e.type === 'abort' ? 'native_aborted' : 'native_error';
      throw new BridgeError(code, 502);
    }
    if (/^(text|reasoning)-(start|delta|end)$/.test(e.type)) {
      const [kind, action] = e.type.split('-');
      ensure(typeof e.id === 'string' && e.id.length > 0, 'missing_block_id', 502);
      const block = this.blocks.get(e.id);
      if (action === 'start') {
        ensure(!block, 'duplicate_block', 502);
        this.blocks.set(e.id, { kind, closed: false });
        return [event({ type: 'block-start', blockId: e.id, kind })];
      }
      ensure(block && !block.closed && block.kind === kind, 'orphan_block_event', 502);
      if (action === 'end') { block.closed = true; return [event({ type: 'block-end', blockId: e.id })]; }
      ensure(typeof e.text === 'string', 'invalid_text_delta', 502);
      if (kind === 'text' && e.text.length) this.visible = true;
      return [event({ type: 'block-delta', blockId: e.id, text: e.text })];
    }
    if (e.type.startsWith('tool-input-')) {
      const id = e.id ?? e.toolCallId;
      ensure(typeof id === 'string' && id.length, 'missing_call_id', 502);
      if (e.type === 'tool-input-start') {
        ensure(!this.tools.has(id) && !this.seenCalls.has(id), 'duplicate_tool_call', 502);
        const binding = this.request.toolsByWireName.get(e.toolName);
        const streaming = e.providerExecuted !== true && binding?.kind === 'function';
        this.tools.set(id, { name: e.toolName, raw: '', bytes: 0, ended: false, provider: e.providerExecuted === true, streaming });
        if (streaming) return [event({ type: 'tool-start', callId: id, clientName: binding.clientName,
          ...(binding.namespace ? { namespace: binding.namespace } : {}) })];
      } else {
        const tool = this.tools.get(id);
        ensure(tool && !tool.ended, 'orphan_tool_input', 502);
        if (e.type === 'tool-input-delta') {
          ensure(typeof e.delta === 'string', 'invalid_tool_delta', 502);
          tool.raw += e.delta;
          tool.bytes += Buffer.byteLength(e.delta);
          ensure(tool.bytes <= this.profile.limits.toolArgumentBytes, 'tool_arguments_too_large', 502);
          if (tool.streaming && e.delta.length) return [event({ type: 'tool-delta', callId: id, delta: e.delta })];
        } else if (e.type === 'tool-input-end') tool.ended = true;
        else throw new BridgeError('unknown_native_event', 502);
      }
      return [];
    }
    if (e.type === 'tool-call') {
      const id = e.toolCallId ?? e.id, name = e.toolName;
      ensure(typeof id === 'string' && id && typeof name === 'string' && name, 'invalid_tool_call', 502);
      ensure(!this.seenCalls.has(id), 'duplicate_tool_call', 502);
      const tool = this.tools.get(id);
      if (tool) ensure(tool.ended && tool.name === name, 'incomplete_tool_arguments', 502);
      ensure(!tool?.streaming || e.providerExecuted !== true, 'tool_ownership_changed', 502);
      const input = argumentsObject(e.input ?? e.args, undefined, 502);
      const raw = tool?.raw.length ? tool.raw : JSON.stringify(input);
      ensure(Buffer.byteLength(raw) <= this.profile.limits.toolArgumentBytes, 'tool_arguments_too_large', 502);
      ensure(isDeepStrictEqual(argumentsObject(raw, undefined, 502), input), 'tool_arguments_mismatch', 502);
      this.tools.delete(id); this.seenCalls.add(id);
      if (e.providerExecuted === true || tool?.provider) { this.providerCalls.add(id); return []; }
      const binding = this.request.toolsByWireName.get(name);
      ensure(binding, 'unknown_native_tool', 502);
      this.clientCalls++;
      return [event({ type: 'tool-call', callId: id, clientName: binding.clientName, kind: binding.kind, input, rawArguments: raw,
        ...(binding.namespace ? { namespace: binding.namespace } : {}) })];
    }
    if (e.type === 'tool-result' || e.type === 'tool-error') {
      ensure(this.providerCalls.has(e.toolCallId) || e.providerExecuted === true, 'unsupported_provider_result', 502);
      return [];
    }
    if (e.type === 'finish') {
      this.finishEvent = e;
      return [];
    }
    throw new BridgeError('unknown_native_event', 502);
  }
  close() {
    ensure(this.finishEvent, 'truncated_stream', 502);
    const raw = this.finishEvent.rawFinishReason ?? this.finishEvent.finishReason;
    const reason = ['stop', 'end_turn'].includes(raw) ? 'end_turn'
      : ['tool-calls', 'tool_calls', 'tool_use'].includes(raw) ? 'tool_use'
      : ['length', 'max_tokens'].includes(raw) ? 'max_tokens' : raw === 'pause_turn' ? 'pause_turn' : null;
    ensure(reason, 'unknown_finish_reason', 502);
    const open = [...this.blocks.values()].some(b => !b.closed);
    // A preview may be partial; never mark an unvalidated client call complete.
    ensure(![...this.tools.values()].some(t => t.streaming), 'incomplete_tool_arguments', 502);
    ensure(reason === 'max_tokens' || (!open && this.tools.size === 0), 'incomplete_native_content', 502);
    if (reason === 'tool_use') ensure(this.clientCalls > 0, 'empty_tool_finish', 502);
    if (reason === 'end_turn') ensure(this.visible || this.clientCalls > 0, 'empty_visible_output', 502);
    const usage = normalizeUsage(this.finishEvent.totalUsage, this.metadata);
    const detail = this.finishEvent.totalUsage.inputTokenDetails;
    return { reason, usage, cache: { read: detail?.cacheReadTokens ?? null,
      write: detail?.cacheWriteTokens ?? null, uncached: detail?.noCacheTokens ?? null } };
  }
}

async function timed(promise, ms, controller, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { const error = new BridgeError(code, 504); controller.abort(error); reject(error); }, Math.max(1, ms));
    })]);
  } finally { clearTimeout(timer); }
}

function openNative(request, signal) {
  // node:http has no hidden 300-second body timeout; our own timers govern silence.
  return new Promise((resolve, reject) => {
    const transport = request.url.startsWith('https:') ? https : http;
    const req = transport.request(request.url, {
      method: request.method, headers: request.headers, signal,
    }, resolve);
    req.on('error', reject);
    req.end(JSON.stringify(request.body));
  });
}

export async function* generate(request, profile, signal) {
  const abort = new AbortController();
  const onAbort = () => abort.abort(signal.reason ?? new BridgeError('client_disconnected', 499));
  if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  const seenCalls = new Set();
  let totals = null, cache = null, totalBytes = 0;
  try {
    for (let segment = 0; segment < profile.upstream.pauseContinuation.maxSegments; segment++) {
      abort.signal.throwIfAborted();
      let response;
      try {
        response = await timed(openNative(request, abort.signal),
          profile.timeouts.upstreamHeadersMs, abort, 'upstream_headers_timeout');
      } catch (error) { throw abort.signal.reason ?? error; }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy();
        const error = new BridgeError(response.statusCode === 429 ? 'upstream_rate_limit'
          : [401, 403].includes(response.statusCode) ? 'upstream_auth' : 'upstream_http_error', response.statusCode === 429 ? 429 : 502);
        const retry = response.headers['retry-after'];
        if (retry && (/^\d{1,7}$/.test(retry) || Number.isFinite(Date.parse(retry)))) error.retryAfter = retry;
        throw error;
      }
      const reader = response[Symbol.asyncIterator]();
      const reducer = new NativeReducer(request, profile, segment, seenCalls);
      let tailDeadline;
      async function* bytes() {
        while (true) {
          abort.signal.throwIfAborted();
          const remaining = tailDeadline === undefined ? profile.timeouts.upstreamIdleMs : tailDeadline - Date.now();
          const next = await timed(reader.next(), remaining, abort, tailDeadline === undefined ? 'upstream_idle_timeout' : 'terminal_drain_timeout');
          if (next.done) return;
          yield next.value;
        }
      }
      try {
        yield { type: 'upstream-ready', segment };
        for await (const native of parseNativeLines(bytes(), profile.limits.nativeLineBytes)) {
          totalBytes += Buffer.byteLength(JSON.stringify(native));
          ensure(totalBytes <= profile.limits.turnOutputBytes, 'turn_output_too_large', 502);
          const events = reducer.push(native);
          if (native.type === 'finish') tailDeadline = Date.now() + profile.timeouts.terminalDrainMs;
          for (const event of events) yield event;
        }
        const result = reducer.close();
        totals = addUsage(totals, result.usage);
        cache = cache === null ? result.cache : Object.fromEntries(Object.keys(cache).map(key =>
          [key, cache[key] === null || result.cache[key] === null ? null : cache[key] + result.cache[key]]));
        if (result.reason !== 'pause_turn') {
          yield { type: 'finish', reason: result.reason, usage: totals, cache };
          return;
        }
        ensure(profile.upstream.pauseContinuation.enabled, 'pause_continuation_unverified', 502);
      } finally {
        response.destroy();
        await reader.return().catch(() => {});
      }
    }
    throw new BridgeError('continuation_limit', 502);
  } catch (error) {
    throw abort.signal.reason ?? error;
  } finally {
    abort.abort();
    signal.removeEventListener('abort', onAbort);
  }
}
