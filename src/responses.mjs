import { randomUUID } from 'node:crypto';
import {
  BridgeError, ensure, fields, array, string, object, optionalBoolean, argumentsObject, dataUrlPart,
  validateTurn, modelFor, responsesUsage, errorBody,
} from './core.mjs';

function textParts(value, output = false) {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  return array(value, 'content').map(part => {
    if (part?.type === 'input_image') {
      fields(part, ['type', 'image_url', 'detail'], 'input_image');
      // Codex view_image sends high. Preserve its complete image bytes for native vision.
      ensure(part.detail === undefined || ['auto', 'high'].includes(part.detail), 'unsupported_parameter', 422, 'image.detail');
      return dataUrlPart(part.image_url);
    }
    fields(part, ['type', 'text', 'annotations', 'logprobs'], 'content');
    ensure(['input_text', 'output_text', 'text'].includes(part.type), 'unsupported_parameter', 422, 'content');
    if (part.annotations !== undefined) ensure(array(part.annotations, 'annotations').length === 0, 'unsupported_parameter', 422, 'annotations');
    if (part.logprobs !== undefined) ensure(array(part.logprobs, 'logprobs').length === 0, 'unsupported_parameter', 422, 'logprobs');
    return { type: 'text', text: string(part.text, 'text') };
  });
}
function inputItem(item) {
  object(item, 'input');
  if (item.type === 'function_call' || item.type === 'tool_search_call') {
    fields(item, ['type', 'id', 'call_id', 'name', 'namespace', 'arguments', 'status', 'execution'], 'input.call');
    const search = item.type === 'tool_search_call';
    if (search) ensure(item.execution === 'client', 'unsupported_parameter', 422, 'execution');
    return { role: 'assistant', parts: [{ type: 'tool-call', kind: search ? 'tool_search' : 'function',
      callId: string(item.call_id, 'call_id', true), name: search ? 'tool_search' : string(item.name, 'name', true),
      ...(item.namespace != null ? { namespace: string(item.namespace, 'namespace', true) } : {}),
      input: argumentsObject(item.arguments), owner: 'client' }] };
  }
  if (item.type === 'function_call_output') {
    fields(item, ['type', 'id', 'call_id', 'output', 'status'], 'input.result');
    return { role: 'tool', parts: [{ type: 'tool-result', callId: string(item.call_id, 'call_id', true),
      parts: textParts(item.output, true), isError: false }] };
  }
  if (item.type === 'tool_search_output') {
    fields(item, ['type', 'id', 'call_id', 'tools', 'status', 'execution'], 'input.search_output');
    ensure(item.execution === 'client' && ['completed', 'incomplete', 'failed'].includes(item.status), 'unsupported_parameter', 422, 'tool_search_output');
    return { role: 'tool', parts: [{ type: 'tool-search-result', callId: string(item.call_id, 'call_id', true),
      execution: 'client', status: item.status, tools: array(item.tools, 'tools').map(t => object(t, 'tools')) }] };
  }
  if (item.type === 'reasoning') {
    fields(item, ['type', 'id', 'summary', 'status', 'encrypted_content'], 'input.reasoning');
    ensure(item.encrypted_content == null, 'unsupported_encrypted_reasoning');
    return { role: 'assistant', parts: array(item.summary, 'summary').map(s => {
      fields(s, ['type', 'text'], 'summary');
      ensure(s.type === 'summary_text', 'unsupported_parameter', 422, 'summary');
      return { type: 'reasoning', text: string(s.text, 'summary.text'), sourceItemId: item.id };
    }) };
  }
  fields(item, ['type', 'id', 'role', 'content', 'status', 'phase'], 'input.message');
  if (item.phase != null) ensure(['commentary', 'final_answer'].includes(item.phase), 'unsupported_parameter', 422, 'input.phase');
  ensure(item.type === undefined || item.type === 'message', 'unsupported_parameter', 422, 'input');
  ensure(['user', 'assistant', 'system', 'developer'].includes(item.role), 'invalid_role');
  const parts = textParts(item.content);
  ensure(item.role === 'user' || parts.every(p => p.type === 'text'), 'unsupported_parameter', 422, 'content');
  return { role: item.role, parts };
}

export function decodeResponses(body, context, profile) {
  fields(body, ['model', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls', 'max_output_tokens',
    'stream', 'temperature', 'store', 'previous_response_id', 'conversation', 'metadata', 'prompt_cache_key',
    'reasoning', 'text', 'include', 'background', 'truncation', 'service_tier', 'client_metadata'], 'body');
  modelFor(profile, body.model);
  ensure(body.store === undefined || body.store === false, 'unsupported_store');
  ensure(body.previous_response_id == null && body.conversation == null, 'unsupported_previous_response');
  ensure(body.tool_choice === undefined || body.tool_choice === 'auto', 'unsupported_parameter', 422, 'tool_choice');
  ensure(optionalBoolean(body.parallel_tool_calls, 'parallel_tool_calls', true), 'unsupported_parameter', 422, 'parallel_tool_calls');
  ensure(!optionalBoolean(body.background, 'background'), 'unsupported_parameter', 422, 'background');
  ensure(body.truncation === undefined || body.truncation === 'disabled', 'unsupported_parameter', 422, 'truncation');
  ensure(body.service_tier === undefined || body.service_tier === 'auto', 'unsupported_parameter', 422, 'service_tier');
  // This requests optional output data. No encrypted state exists for Muse; never fabricate it.
  if (body.include !== undefined) ensure(array(body.include, 'include').every(x => x === 'reasoning.encrypted_content'), 'unsupported_parameter', 422, 'include');
  if (body.client_metadata !== undefined) object(body.client_metadata, 'client_metadata');
  if (body.prompt_cache_key !== undefined) string(body.prompt_cache_key, 'prompt_cache_key');
  if (body.reasoning !== undefined) fields(body.reasoning, ['effort', 'summary'], 'reasoning');
  if (body.text !== undefined) {
    fields(body.text, ['format'], 'text');
    if (body.text.format !== undefined) {
      fields(body.text.format, ['type'], 'text.format');
      ensure(body.text.format.type === 'text', 'unsupported_parameter', 422, 'text.format');
    }
  }
  const metadata = body.metadata ?? {};
  object(metadata, 'metadata');
  ensure(Object.keys(metadata).length <= 16, 'invalid_request', 400, 'metadata');
  for (const [key, value] of Object.entries(metadata)) ensure(key.length <= 64 && typeof value === 'string' && value.length <= 512, 'invalid_request', 400, 'metadata');
  const messages = typeof body.input === 'string' ? [{ role: 'user', parts: [{ type: 'text', text: body.input }] }]
    : array(body.input, 'input').map(inputItem);
  const expanded = array(body.tools ?? [], 'tools').flatMap(t => {
    if (t?.type !== 'namespace') return [{ tool: t }];
    fields(t, ['type', 'name', 'description', 'tools'], 'tools.namespace');
    const namespace = string(t.name, 'namespace', true);
    if (t.description !== undefined) string(t.description, 'tools.namespace.description');
    return array(t.tools, 'tools.namespace.tools').map(tool => ({ tool, namespace, description: t.description }));
  });
  const tools = expanded.map(({ tool: t, namespace, description }) => {
    if (t?.type === 'tool_search') {
      fields(t, ['type', 'execution', 'description', 'parameters'], 'tools.tool_search');
      ensure(t.execution === 'client', 'unsupported_parameter', 422, 'tools.execution');
      return { kind: 'tool_search', name: 'tool_search', execution: 'client',
        ...(t.description !== undefined ? { description: string(t.description, 'tools.description') } : {}),
        schema: object(t.parameters, 'tools.parameters') };
    }
    fields(t, ['type', 'name', 'description', 'parameters', 'strict'], 'tools');
    ensure(t.type === 'function' && (t.strict === undefined || t.strict === false || t.strict === null), 'unsupported_parameter', 422, 'tools');
    const toolDescription = t.description !== undefined ? string(t.description, 'tools.description') : undefined;
    return { kind: 'function', name: string(t.name, 'tools.name', true), execution: 'client',
      ...(namespace ? { namespace } : {}),
      ...(description !== undefined || toolDescription !== undefined ? { description: [description, toolDescription].filter(x => x !== undefined).join('\n') } : {}),
      schema: object(t.parameters, 'tools.parameters') };
  });
  return validateTurn({ protocol: 'responses', publicModel: body.model,
    system: body.instructions == null ? { kind: 'absent' } : { kind: 'string', text: string(body.instructions, 'instructions') },
    messages, tools, stream: optionalBoolean(body.stream, 'stream'), maxTokens: body.max_output_tokens,
    temperature: body.temperature, reasoningEffort: body.reasoning?.effort ?? undefined,
    reasoningSummary: body.reasoning?.summary ?? undefined, metadata: structuredClone(metadata) }, profile);
}

export function createResponsesEncoder(turn, profile) {
  const id = 'resp_' + randomUUID().replaceAll('-', ''), created = Math.floor(Date.now() / 1000);
  const items = [], blocks = new Map(), calls = new Map();
  let sequence = 0, started = false, terminal = false, completed = false, usage = null, status = 'in_progress', failure = null, incomplete = null;
  const emit = (type, value) => ({ type, ...structuredClone(value), sequence_number: sequence++ });
  const response = () => ({ id, object: 'response', created_at: created, status, model: turn.publicModel,
    output: structuredClone(items), error: failure, incomplete_details: incomplete, usage, store: false,
    metadata: structuredClone(turn.metadata), parallel_tool_calls: true, tool_choice: 'auto',
    max_output_tokens: turn.maxTokens ?? null, previous_response_id: null });
  const close = block => {
    if (block.closed) return [];
    block.closed = true; block.item.status = 'completed';
    const common = { item_id: block.item.id, output_index: block.index };
    if (block.kind === 'reasoning') return [
      emit('response.reasoning_summary_text.done', { ...common, summary_index: 0, text: block.item.summary[0].text }),
      emit('response.reasoning_summary_part.done', { ...common, summary_index: 0, part: block.item.summary[0] }),
      emit('response.output_item.done', { output_index: block.index, item: block.item }),
    ];
    return [
      emit('response.output_text.done', { ...common, content_index: 0, text: block.item.content[0].text, logprobs: [] }),
      emit('response.content_part.done', { ...common, content_index: 0, part: block.item.content[0] }),
      emit('response.output_item.done', { output_index: block.index, item: block.item }),
    ];
  };
  return {
    start() {
      ensure(!started, 'encoder_already_started', 500); started = true;
      return [emit('response.created', { response: response() }), emit('response.in_progress', { response: response() })];
    },
    push(e) {
      ensure(started && !terminal, 'encoder_state_error', 500);
      const key = e.segment + ':' + e.blockId;
      if (e.type === 'block-start') {
        ensure(!blocks.has(key), 'duplicate_block', 502);
        if (e.kind === 'reasoning') ensure(modelFor(profile, turn.publicModel).reasoningText === 'verified', 'unsupported_reasoning_output', 502);
        const index = items.length, itemId = (e.kind === 'reasoning' ? 'rs_' : 'msg_') + randomUUID().replaceAll('-', '');
        const item = e.kind === 'reasoning'
          ? { id: itemId, type: 'reasoning', status: 'in_progress', summary: [{ type: 'summary_text', text: '' }] }
          : { id: itemId, type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text: '', annotations: [], logprobs: [] }] };
        items.push(item); blocks.set(key, { kind: e.kind, index, item, closed: false });
        const added = { ...item, ...(e.kind === 'reasoning' ? { summary: [] } : { content: [] }) };
        return [emit('response.output_item.added', { output_index: index, item: added }),
          e.kind === 'reasoning'
            ? emit('response.reasoning_summary_part.added', { item_id: itemId, output_index: index, summary_index: 0, part: item.summary[0] })
            : emit('response.content_part.added', { item_id: itemId, output_index: index, content_index: 0, part: item.content[0] })];
      }
      if (e.type === 'block-delta' || e.type === 'block-end') {
        const block = blocks.get(key);
        ensure(block && !block.closed, 'orphan_block_event', 502);
        if (e.type === 'block-end') return close(block);
        const common = { item_id: block.item.id, output_index: block.index, delta: e.text };
        if (block.kind === 'reasoning') {
          block.item.summary[0].text += e.text;
          return [emit('response.reasoning_summary_text.delta', { ...common, summary_index: 0 })];
        }
        block.item.content[0].text += e.text;
        return [emit('response.output_text.delta', { ...common, content_index: 0, logprobs: [] })];
      }
      if (e.type === 'tool-start') {
        ensure(!calls.has(e.callId), 'duplicate_tool_call', 502);
        const index = items.length;
        const item = { id: 'fc_' + randomUUID().replaceAll('-', ''), type: 'function_call', call_id: e.callId,
          status: 'in_progress', name: e.clientName, arguments: '', ...(e.namespace ? { namespace: e.namespace } : {}) };
        items.push(item); calls.set(e.callId, { index, item });
        return [emit('response.output_item.added', { output_index: index, item })];
      }
      if (e.type === 'tool-delta') {
        const call = calls.get(e.callId);
        ensure(call && call.item.status === 'in_progress', 'orphan_tool_input', 502);
        call.item.arguments += e.delta;
        return [emit('response.function_call_arguments.delta', { item_id: call.item.id, output_index: call.index, delta: e.delta })];
      }
      if (e.type === 'tool-call') {
        const index = items.length;
        if (e.kind === 'tool_search') {
          const item = { id: 'ts_' + randomUUID().replaceAll('-', ''), type: 'tool_search_call', call_id: e.callId,
            status: 'completed', execution: 'client', arguments: structuredClone(e.input) };
          items.push(item);
          return [emit('response.output_item.added', { output_index: index, item: { ...item, status: 'in_progress' } }),
            emit('response.output_item.done', { output_index: index, item })];
        }
        const output = calls.has(e.callId) ? [] : this.push({ ...e, type: 'tool-start' });
        const call = calls.get(e.callId), item = call.item;
        ensure(item.status === 'in_progress' && item.name === e.clientName && (!item.arguments || item.arguments === e.rawArguments), 'tool_arguments_mismatch', 502);
        if (!item.arguments) output.push(...this.push({ type: 'tool-delta', callId: e.callId, delta: e.rawArguments }));
        item.status = 'completed';
        return [...output,
          emit('response.function_call_arguments.done', { item_id: item.id, output_index: call.index, name: item.name, arguments: e.rawArguments }),
          emit('response.output_item.done', { output_index: call.index, item })];
      }
      ensure(e.type === 'finish', 'encoder_state_error', 500);
      ensure([...calls.values()].every(c => c.item.status === 'completed'), 'incomplete_tool_arguments', 502);
      const output = [...blocks.values()].flatMap(close);
      usage = responsesUsage(e.usage);
      status = e.reason === 'max_tokens' ? 'incomplete' : 'completed';
      incomplete = status === 'incomplete' ? { reason: 'max_output_tokens' } : null;
      terminal = true; completed = true;
      return [...output, emit('response.' + status, { response: response() })];
    },
    fail(error) {
      if (terminal) return [];
      terminal = true; status = 'failed';
      const safe = errorBody('responses', error).error;
      failure = { code: safe.code, message: safe.message };
      return [emit('response.failed', { response: response() })];
    },
    result() { ensure(completed, 'incomplete_response', 500); return response(); },
  };
}
