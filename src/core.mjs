export class BridgeError extends Error {
  constructor(code, status = 422, param) {
    super(code);
    this.name = 'BridgeError';
    this.code = code;
    this.status = status;
    this.param = param;
    this.retryable = false;
  }
}
export function ensure(ok, code = 'invalid_request', status = 422, param) {
  if (!ok) throw new BridgeError(code, status, param);
}
export function object(value, param = 'body') {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid_request', 400, param);
  return value;
}
export function string(value, param, nonempty = false) {
  ensure(typeof value === 'string' && (!nonempty || value.length > 0), 'invalid_request', 400, param);
  return value;
}
export function array(value, param) {
  ensure(Array.isArray(value), 'invalid_request', 400, param);
  return value;
}
export function fields(value, allowed, param = 'body') {
  object(value, param);
  for (const key of Object.keys(value)) {
    // The name of an unknown user-supplied key may itself contain private data.
    ensure(allowed.includes(key), 'unsupported_parameter', 422, param);
  }
  return value;
}
export function optionalBoolean(value, param, fallback = false) {
  ensure(value === undefined || typeof value === 'boolean', 'invalid_request', 400, param);
  return value ?? fallback;
}
export function positive(value, param) {
  ensure(Number.isSafeInteger(value) && value > 0, 'invalid_request', 400, param);
  return value;
}
export function argumentsObject(value, param = 'arguments', status = 422) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new BridgeError('invalid_tool_arguments', status, param); }
  }
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid_tool_arguments', status, param);
  return value;
}
export function modelFor(profile, name) {
  string(name, 'model', true);
  ensure(Object.hasOwn(profile.models, name), 'unknown_model', 422, 'model');
  return profile.models[name];
}
export function validateNativeConfig(value) {
  object(value, 'config');
  for (const key of ['workingDir', 'date', 'environment', 'currentBranch', 'mainBranch', 'gitStatus'])
    ensure(typeof value[key] === 'string', 'invalid_native_config', 503);
  ensure(typeof value.isGitRepo === 'boolean' && Array.isArray(value.structure) && Array.isArray(value.recentCommits), 'invalid_native_config', 503);
  return value;
}
export const effortInputs = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export function clientDefaults(profile) {
  const names = Object.keys(profile.models);
  return profile.clients ?? { codex: { model: names[0], effort: 'high' },
    claude: { model: names[1] ?? names[0], effort: 'high' } };
}
export function imagePart(mediaType, data) {
  ensure(['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType), 'unsupported_image', 422, 'image');
  string(data, 'image', true);
  ensure(/^[A-Za-z0-9+/]*={0,2}$/.test(data) && data.length % 4 !== 1, 'invalid_image', 400, 'image');
  const decoded = Buffer.from(data, 'base64');
  ensure(decoded.length && decoded.toString('base64').replace(/=+$/, '') === data.replace(/=+$/, ''), 'invalid_image', 400, 'image');
  return { type: 'image', mediaType, data };
}
export function dataUrlPart(url) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(string(url, 'image_url'));
  ensure(match, 'unsupported_image', 422, 'image_url');
  return imagePart(match[1], match[2]);
}
export function cacheSection(section) {
  fields(section, ['type', 'text', 'cache_control'], 'system');
  ensure(section.type === 'text', 'unsupported_parameter', 422, 'system');
  if (section.cache_control !== undefined) {
    fields(section.cache_control, ['type'], 'cache_control');
    ensure(section.cache_control.type === 'ephemeral', 'unsupported_parameter', 422, 'cache_control');
  }
  return { text: string(section.text, 'system.text'), cache: section.cache_control !== undefined };
}
export function systemInput(value) {
  if (value === undefined) return { kind: 'absent' };
  if (typeof value === 'string') return { kind: 'string', text: value };
  return { kind: 'sections', sections: array(value, 'system').map(cacheSection) };
}
export function toolName(value) {
  string(value, 'tool.name', true);
  ensure(value.length <= 128 && !/[\x00-\x20]/.test(value), 'invalid_tool_name');
  return value;
}
export function validateTurn(turn, profile) {
  const model = modelFor(profile, turn.publicModel);
  turn.requestedEffort = turn.reasoningEffort ?? null;
  if (model.effortMap) {
    const input = turn.reasoningEffort ?? 'default';
    ensure(effortInputs.includes(input) && Object.hasOwn(model.effortMap, input), 'unsupported_effort', 422, 'reasoning.effort');
    const mapped = model.effortMap[input];
    ensure(mapped !== 'reject', 'unsupported_effort', 422, 'reasoning.effort');
    turn.reasoningEffort = mapped === 'omit' ? undefined : mapped;
  }
  ensure(turn.messages.length > 0, 'invalid_request', 400, 'messages');
  if (turn.maxTokens !== undefined) positive(turn.maxTokens, 'max_tokens');
  if (model.maxOutputTokens !== undefined) {
    ensure((turn.maxTokens ?? model.defaultMaxTokens) <= model.maxOutputTokens, 'max_tokens_exceeded', 422, 'max_tokens');
  }
  if (turn.temperature !== undefined) {
    const range = model.temperatureRange;
    ensure(range && Number.isFinite(turn.temperature) && turn.temperature >= range[0] && turn.temperature <= range[1],
      'unsupported_parameter', 422, 'temperature');
  }
  if (turn.reasoningEffort !== undefined) ensure(model.efforts.includes(turn.reasoningEffort), 'unsupported_parameter', 422, 'reasoning.effort');
  if (turn.reasoningSummary !== undefined && turn.reasoningSummary !== 'none') {
    ensure(model.reasoningText === 'verified' && ['auto', 'concise', 'detailed'].includes(turn.reasoningSummary), 'unsupported_parameter', 422, 'reasoning.summary');
  }
  const names = new Set();
  for (const tool of turn.tools) {
    toolName(tool.name);
    if (tool.namespace) toolName(tool.namespace);
    const identity = JSON.stringify([tool.namespace ?? null, tool.name]);
    ensure(!names.has(identity), 'duplicate_tool');
    names.add(identity);
    object(tool.schema, 'tools.schema');
    ensure(tool.schema.type === 'object', 'unsupported_parameter', 422, 'tools.schema');
    if (tool.kind === 'tool_search') ensure(model.clientToolSearch, 'unsupported_parameter', 422, 'tools.tool_search');
  }
  for (const message of turn.messages) {
    for (const part of message.parts) {
      if (part.type === 'image') ensure(model.vision, 'unsupported_image');
      if (part.type === 'reasoning') ensure(model.reasoningText === 'verified', 'unsupported_reasoning_history');
      if (part.type === 'tool-result') for (const result of part.parts) {
        ensure(result.type === 'text' || (result.type === 'image' && model.vision), 'unsupported_tool_result_image');
      }
    }
  }
  return turn;
}
export function normalizeUsage(raw, metadata = {}) {
  ensure(raw && typeof raw === 'object', 'missing_usage', 502);
  const detail = raw.inputTokenDetails ?? {};
  const value = {
    input: raw.inputTokens, output: raw.outputTokens,
    cacheRead: detail.cacheReadTokens ?? 0, cacheWrite: detail.cacheWriteTokens ?? 0,
  };
  const reasoning = raw.outputTokenDetails?.reasoningTokens;
  if (reasoning !== undefined) value.reasoning = reasoning;
  const oneHour = metadata.anthropic?.usage?.cache_creation?.ephemeral_1h_input_tokens;
  if (oneHour !== undefined) value.cacheWrite1h = oneHour;
  for (const n of Object.values(value)) ensure(Number.isSafeInteger(n) && n >= 0, 'invalid_usage', 502);
  ensure(value.cacheRead + value.cacheWrite <= value.input, 'invalid_usage', 502);
  if (detail.noCacheTokens !== undefined) ensure(detail.noCacheTokens === value.input - value.cacheRead - value.cacheWrite, 'invalid_usage', 502);
  if (value.reasoning !== undefined) ensure(value.reasoning <= value.output, 'invalid_usage', 502);
  if (value.cacheWrite1h !== undefined) ensure(value.cacheWrite1h <= value.cacheWrite, 'invalid_usage', 502);
  return value;
}
export function addUsage(a, b) {
  if (!a) return { ...b };
  const result = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'cacheWrite1h']) {
    if (a[key] !== undefined || b[key] !== undefined) {
      result[key] = (a[key] ?? 0) + (b[key] ?? 0);
      ensure(Number.isSafeInteger(result[key]), 'invalid_usage', 502);
    }
  }
  return result;
}
export function anthropicUsage(u) {
  return { input_tokens: u.input - u.cacheRead - u.cacheWrite, output_tokens: u.output,
    cache_read_input_tokens: u.cacheRead, cache_creation_input_tokens: u.cacheWrite };
}
export function responsesUsage(u) {
  return { input_tokens: u.input, output_tokens: u.output, total_tokens: u.input + u.output,
    input_tokens_details: { cached_tokens: u.cacheRead },
    output_tokens_details: { reasoning_tokens: u.reasoning ?? 0 } };
}
export function safeError(error) {
  return error instanceof BridgeError ? error : new BridgeError('upstream_error', 502);
}
export function errorBody(protocol, error) {
  const e = safeError(error);
  const message = 'Astra1: ' + e.code;
  if (protocol === 'anthropic') return { type: 'error', error: {
    type: e.status === 401 ? 'authentication_error' : e.status === 429 ? 'rate_limit_error' : e.status < 500 ? 'invalid_request_error' : 'api_error',
    message,
  } };
  return { error: { message, type: e.status < 500 ? 'invalid_request_error' : 'server_error', param: e.param ?? null, code: e.code } };
}
