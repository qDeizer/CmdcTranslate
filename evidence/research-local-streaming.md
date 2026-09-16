# Local streaming comparison — 2026-09-16

Scope: read-only comparison of Astra1 with the local `9router-live` and
`cizi-router` Command Code adapters. No captures, credentials, prompts, tool
payloads, or session identifiers were read or recorded.

## Finding

Text is not deliberately batched in Astra1. `parseNativeLines()` yields each
complete NDJSON record as it arrives (`src/commandcode.mjs:109-131`), the native
reducer emits each text/reasoning delta (`156-169`), and the server commits at
the first non-empty text delta then writes each resulting SSE frame in order
(`src/server.mjs:238-295`). Existing live evidence records at most 1 ms from a
native text delta to bridge output.

Tool arguments are deliberately batched. Astra1 appends every
`tool-input-delta` to `tool.raw` without emitting a bridge event
(`src/commandcode.mjs:171-187`). It only emits a `tool-call` after the terminal
event has arrived, the JSON has parsed, and the parsed JSON deep-equals the
terminal input (`189-205`). Both client encoders consequently emit their entire
argument string as one operation: Anthropic uses one `input_json_delta`
(`src/anthropic.mjs:132-140`); Responses emits one
`response.function_call_arguments.delta` (`src/responses.mjs:181-197`). This is
the direct explanation for tools/files appearing all at once.

The local reference routers stream tool argument pieces immediately. Their
Command Code executor splits received NDJSON by newline and emits converted
chunks synchronously per line (`9router-live/open-sse/executors/commandcode.js:98-134`; same structure in cizi-router). Its converter maps `tool-input-start`
to an OpenAI tool-call start and each `tool-input-delta` to an arguments delta
(`9router-live/open-sse/translator/response/commandcode-to-openai.js:148-180`).
The regular SSE translation path pipes transform output directly to the client
(`open-sse/handlers/chatCore/streamingHandler.js:43-69`).

Reasoning uses the same incremental block-delta path as text. A non-empty
reasoning delta also committed the stream before this change; it is not a
separate one-second buffering source. The prelude timer only covers a stream
that has not produced a content event.

## Recommended smallest safe change

Extend the internal `BridgeEvent` and both encoders with tool-input start/delta
events. Forward each raw delta immediately, but keep the current terminal
`tool-call` parse/deep-equality check as the sole authorization to emit the
tool's completion/finish state. Do not execute a client tool based on streamed
partial JSON. The contract currently has only a consolidated `tool-call`
variant (`contracts.d.ts:102-110`), so this requires contract and acceptance
coverage, especially the existing interleaved/mismatched tool gate F11.

## Pitfalls

- Do not copy the reference routers' finalization behavior wholesale: their
  converter emits terminal output on `finish` even without Astra1's verified
  finish/closed-block checks. Astra1 must preserve `NativeReducer.close()`
  validation (`src/commandcode.mjs:217-231`).
- A client can observe partial tool JSON but must never be permitted to run it.
  On terminal mismatch/error, send the appropriate stream error and do not
  send a successful tool completion.
- Keep one ordered writer and backpressure handling (`src/server.mjs:151-165`);
  emitting a start/delta/final tool sequence must not race heartbeat or later
  text blocks.
- The reference adapter is an OpenAI-chat intermediate; it does not establish
  correct Anthropic Messages or OpenAI Responses event semantics. Astra1's
  protocol-native encoders should be changed directly.
