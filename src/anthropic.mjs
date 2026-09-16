import { randomUUID } from 'node:crypto';
import {
  BridgeError, ensure, fields, array, string, object, optionalBoolean, positive, argumentsObject,
  imagePart, systemInput, cacheSection, validateTurn, modelFor, anthropicUsage, errorBody,
} from './core.mjs';

function content(value, role) {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  return array(value, 'content').map(part => {
    object(part, 'content');
    switch (part.type) {
      case 'text':
        cacheSection(part); // Native CLI consumes text; per-message cache placement is provider-managed.
        return { type: 'text', text: string(part.text, 'text') };
      case 'image':
        ensure(role === 'user', 'unsupported_image');
        fields(part, ['type', 'source'], 'image');
        fields(part.source, ['type', 'media_type', 'data'], 'image.source');
        ensure(part.source.type === 'base64', 'unsupported_image');
        return imagePart(part.source.media_type, part.source.data);
      case 'thinking':
        ensure(role === 'assistant', 'invalid_role');
        fields(part, ['type', 'thinking', 'signature'], 'thinking');
        if (part.signature !== undefined) string(part.signature, 'signature');
        return { type: 'reasoning', text: string(part.thinking, 'thinking') };
      case 'tool_use':
        ensure(role === 'assistant', 'invalid_role');
        fields(part, ['type', 'id', 'name', 'input'], 'tool_use');
        return { type: 'tool-call', callId: string(part.id, 'tool_use.id', true), name: string(part.name, 'tool_use.name', true),
          kind: 'function', input: argumentsObject(part.input), owner: 'client' };
      case 'tool_result': {
        ensure(role === 'user', 'invalid_role');
        fields(part, ['type', 'tool_use_id', 'content', 'is_error', 'cache_control'], 'tool_result');
        if (part.cache_control !== undefined) cacheSection({ type: 'text', text: '', cache_control: part.cache_control });
        const parts = typeof part.content === 'string' ? [{ type: 'text', text: part.content }]
          : array(part.content ?? [], 'tool_result.content').map(p => {
            if (p?.type === 'image') return content([p], 'user')[0];
            fields(p, ['type', 'text'], 'tool_result.content');
            ensure(p.type === 'text', 'unsupported_tool_result_image');
            return { type: 'text', text: string(p.text, 'tool_result.text') };
          });
        return { type: 'tool-result', callId: string(part.tool_use_id, 'tool_use_id', true), parts,
          isError: optionalBoolean(part.is_error, 'is_error') };
      }
      default: throw new BridgeError('unsupported_parameter', 422, 'content');
    }
  });
}

export function decodeAnthropic(body, context, profile) {
  fields(body, ['model', 'messages', 'max_tokens', 'stream', 'system', 'tools', 'tool_choice',
    'temperature', 'thinking', 'output_config', 'metadata', 'stop_sequences'], 'body');
  const model = modelFor(profile, body.model);
  if (body.stop_sequences !== undefined) ensure(array(body.stop_sequences, 'stop_sequences').length === 0, 'unsupported_parameter', 422, 'stop_sequences');
  if (body.tool_choice !== undefined) {
    fields(body.tool_choice, ['type', 'disable_parallel_tool_use'], 'tool_choice');
    ensure(body.tool_choice.type === 'auto' && optionalBoolean(body.tool_choice.disable_parallel_tool_use, 'disable_parallel_tool_use') === false,
      'unsupported_parameter', 422, 'tool_choice');
  }
  let reasoningEffort = body.output_config?.effort;
  if (body.output_config !== undefined) fields(body.output_config, ['effort'], 'output_config');
  if (body.thinking !== undefined) {
    fields(body.thinking, ['type', 'budget_tokens'], 'thinking');
    if (body.thinking.type === 'adaptive') {
      ensure(body.thinking.budget_tokens === undefined && body.output_config?.effort !== undefined, 'unsupported_parameter', 422, 'thinking');
      reasoningEffort = string(body.output_config.effort, 'output_config.effort');
      // Shared validateTurn applies the explicitly configured effort mapping.
    } else {
      ensure(body.thinking.type === 'disabled' && body.thinking.budget_tokens === undefined, 'unsupported_parameter', 422, 'thinking');
    }
  }
  if (body.metadata !== undefined) {
    fields(body.metadata, ['user_id'], 'metadata');
    if (body.metadata.user_id !== undefined) string(body.metadata.user_id, 'metadata.user_id');
  }
  const messages = array(body.messages, 'messages').map(m => {
    fields(m, ['role', 'content'], 'messages');
    // Claude Code 2.1.272 also sends a text system message in the messages array.
    ensure(['user', 'assistant', 'system'].includes(m.role), 'invalid_role');
    return { role: m.role, parts: content(m.content, m.role) };
  });
  const tools = array(body.tools ?? [], 'tools').map(t => {
    fields(t, ['name', 'description', 'input_schema', 'cache_control'], 'tools');
    if (t.cache_control !== undefined) cacheSection({ type: 'text', text: '', cache_control: t.cache_control });
    return { kind: 'function', name: string(t.name, 'tools.name', true),
      ...(t.description !== undefined ? { description: string(t.description, 'tools.description') } : {}),
      schema: object(t.input_schema, 'tools.input_schema'), execution: 'client' };
  });
  return validateTurn({ protocol: 'anthropic', publicModel: body.model, system: systemInput(body.system), messages, tools,
    maxTokens: positive(body.max_tokens, 'max_tokens'), stream: optionalBoolean(body.stream, 'stream'),
    temperature: body.temperature, reasoningEffort, metadata: {} }, profile);
}

export function createAnthropicEncoder(turn, profile) {
  const id = 'msg_' + randomUUID().replaceAll('-', '');
  const blocks = new Map(), calls = new Map(), content = [];
  let started = false, terminal = false, completed = false, usage = null, reason = null;
  const snapshot = () => ({ id, type: 'message', role: 'assistant', model: turn.publicModel,
    content: structuredClone(content), stop_reason: reason, stop_sequence: null, usage });
  const close = block => {
    if (block.closed) return [];
    block.closed = true;
    return [{ type: 'content_block_stop', index: block.index }];
  };
  return {
    start() {
      ensure(!started, 'encoder_already_started', 500);
      started = true;
      return [{ type: 'message_start', message: { ...snapshot(), usage: { input_tokens: 0, output_tokens: 0 } } }];
    },
    push(e) {
      ensure(started && !terminal, 'encoder_state_error', 500);
      const key = e.segment + ':' + e.blockId;
      if (e.type === 'block-start') {
        if (e.kind === 'reasoning') ensure(profile && modelFor(profile, turn.publicModel).reasoningText === 'verified', 'unsupported_reasoning_output', 502);
        ensure(!blocks.has(key), 'duplicate_block', 502);
        const index = content.length, block = e.kind === 'reasoning' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' };
        content.push(block); blocks.set(key, { index, block, kind: e.kind, closed: false });
        return [{ type: 'content_block_start', index, content_block: structuredClone(block) }];
      }
      if (e.type === 'block-delta' || e.type === 'block-end') {
        const block = blocks.get(key);
        ensure(block && !block.closed, 'orphan_block_event', 502);
        if (e.type === 'block-end') return close(block);
        if (block.kind === 'reasoning') {
          block.block.thinking += e.text;
          return [{ type: 'content_block_delta', index: block.index, delta: { type: 'thinking_delta', thinking: e.text } }];
        }
        block.block.text += e.text;
        return [{ type: 'content_block_delta', index: block.index, delta: { type: 'text_delta', text: e.text } }];
      }
      if (e.type === 'tool-start') {
        ensure(!calls.has(e.callId), 'duplicate_tool_call', 502);
        const index = content.length;
        const block = { type: 'tool_use', id: e.callId, name: e.clientName, input: {} };
        content.push(block); calls.set(e.callId, { index, block, raw: '', closed: false });
        return [{ type: 'content_block_start', index, content_block: structuredClone(block) }];
      }
      if (e.type === 'tool-delta') {
        const call = calls.get(e.callId);
        ensure(call && !call.closed, 'orphan_tool_input', 502);
        call.raw += e.delta;
        return [{ type: 'content_block_delta', index: call.index, delta: { type: 'input_json_delta', partial_json: e.delta } }];
      }
      if (e.type === 'tool-call') {
        ensure(e.kind === 'function', 'unsupported_tool_search_output', 502);
        const output = calls.has(e.callId) ? [] : this.push({ ...e, type: 'tool-start' });
        const call = calls.get(e.callId);
        ensure(!call.closed && call.block.name === e.clientName && (!call.raw || call.raw === e.rawArguments), 'tool_arguments_mismatch', 502);
        if (!call.raw) output.push(...this.push({ type: 'tool-delta', callId: e.callId, delta: e.rawArguments }));
        call.block.input = structuredClone(e.input);
        return [...output, ...close(call)];
      }
      ensure(e.type === 'finish', 'encoder_state_error', 500);
      ensure([...calls.values()].every(c => c.closed), 'incomplete_tool_arguments', 502);
      const output = [...blocks.values()].flatMap(close);
      usage = anthropicUsage(e.usage); reason = e.reason;
      terminal = true; completed = true;
      return [...output, { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage }, { type: 'message_stop' }];
    },
    fail(error) {
      if (terminal) return [];
      terminal = true;
      return [errorBody('anthropic', error)];
    },
    result() {
      ensure(completed, 'incomplete_response', 500);
      return snapshot();
    },
  };
}

export function estimateTokens(body) {
  fields(body, ['model', 'messages', 'system', 'tools', 'tool_choice', 'thinking'], 'body');
  string(body.model, 'model', true);
  array(body.messages, 'messages');
  let images = 0;
  const serialized = JSON.stringify(body, (key, value) => {
    if (value && typeof value === 'object' && value.type === 'image') { images++; return '[image]'; }
    return value;
  });
  return { input_tokens: Math.ceil(Buffer.byteLength(serialized) / 3) + 4 * body.messages.length + images * 1024 };
}
