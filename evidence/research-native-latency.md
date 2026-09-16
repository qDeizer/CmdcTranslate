# Native latency and compatibility audit — 2026-09-16

Read-only audit of Astra1 source, prior sanitized native evidence, current safe
diagnostics, AIproxy recording inventory, and the pinned CLI wire baseline.
No prompt, credential, or session value is included here.

## Final follow-up: interactive reproduction and fix

The initial audit below predates the fix. Root then reproduced the failure with
Claude Code 2.1.273 in an actual PTY using `scripts/client.mjs`: the auxiliary
request failed at `output_config`, followed by a successful main inference.
The installed executable contains `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`.
Enabling it in the local launcher eliminated the auxiliary request: a fresh
interactive session completed two turns with no 422, with the same conversation
trace. See `claude-interactive-title.json`. JSON-schema semantics remain rejected
at the API boundary rather than being silently discarded.

The revised function-tool path emits start/delta previews immediately and closes
only after terminal JSON validation. The buffering description below applies to
the original baseline, not the final implementation.

## Findings, highest priority first

1. **The recurring Anthropic 422 is a local auxiliary structured-output rejection.**
   `server.mjs` decodes before acquiring a session or opening upstream, so the
   request does not affect native latency, trace binding, or billing. Existing
   release evidence identifies Claude's optional JSON-schema title request; the
   current pattern (immediate 422 followed by a successful main request) matches
   it. `anthropic.mjs` permits only `output_config.effort`; an added structured
   output member is rejected as `unsupported_parameter`. The Responses analogue
   accepts only `text.format.type === "text"`. The normal non-bare CLI batch
   probe did *not* reproduce the auxiliary request: it made two valid requests,
   both with `output_config.effort` only. The rejected request is therefore an
   interactive/UI-specific branch or another conditional client feature, not a
   normal prompt-turn field. Use the new safe parameter diagnostic on that branch
   before broadening an allowlist.

2. **Main-request latency is upstream/model and tool-orchestration time.**
   Prior same-clock evidence measured native text to bridge SSE at 0–1 ms and
   bridge-to-CLI stdout at 7–8 ms. The current first-content and long tool-turn
   observations therefore do not point to HTTP/SSE buffering in Astra1. Large
   request bodies and tool inventories can increase upstream preparation and
   model planning time; they do not create a bridge-side wait after a native
   delta arrives.

3. **There is no unnecessary per-inference account or model preflight.**
   The launcher checks `/healthz` once before spawning a client. `whoami` is
   only used by the admin account/models paths. Inference goes directly from
   decode → session acquire → native POST.

4. **Two intentional timers can affect perceived timing but should be retained
   unless measured as a problem.**
   After upstream headers, the 1 s prelude timer commits an empty SSE prelude
   and enables heartbeats if no safe output appears; it does not hold text that
   has arrived. After native `finish`, the 5 s terminal-drain window permits the
   native sequence `finish` then provider metadata before EOF. It may add only
   post-output completion delay. The latter is required by observed native order.

5. **Terminal and tool sequencing are correct for the observed native wire.**
   Tool input is buffered until the validated terminal tool call. This preserves
   executable-call correctness and explains why tool JSON may look chunked or
   delayed. Text deltas are emitted as they arrive. Do not replace this with
   early executable tool emission.

## Parity and regression guardrails

- Preserve deterministic per-session session/thread identities and conversation
  trace mode. They are independent of the rejected auxiliary request and have
  live continuity evidence.
- Preserve terminal-drain handling: the native baseline contains `finish` before
  provider metadata.
- The normal interactive Claude launch is the settings-based launcher profile,
  not the `--bare` probe profile. Any reproduction must compare those separately.
- Make the new safe diagnostic expose only the decoder parameter/category and
  route; never record request body, prompt, key, or identifiers.

## Recommended next measurement

Run one normal launcher turn and one `--bare` probe with the same current
profile. Record only route, decoder result/parameter, request byte/tool counts,
upstream-ready time, first text/tool time, last text/tool time, finish time, and
terminal-drain duration. This distinguishes auxiliary schema noise from the
main turn without changing cache/session/trace behavior.

## Isolated normal-launch probe

`scripts/probe-claude-compat.mjs` used the current saved profile and credential
through an isolated `makeServer`, temporary Claude settings directory, and a
synthetic local file. It made two live main requests (both successful; 8.579 s
and 5.552 s), with no 422 and no JSON-schema format in either request. The
redacted result is `evidence/claude-compat.json`. The installed CLI is 2.1.273;
its local distribution is a native executable, so no inspectable compiled JS
mapping or disable-title-schema switch was available in the installed files.

## Current interactive-client artifact check

The newest Astra1 Claude project transcript was inspected structurally only. It
contains no `unsupported_parameter` record and no stored paths for
`count_tokens`, `json_schema`, `output_config`, `cache_control`,
`defer_loading`, or `strict`; it records conversation events rather than
outbound HTTP request bodies. It cannot identify the rejected field. A repeat
of the interactive operation against the updated server-side safe
`error.param` diagnostic is required for a decisive result. Until then, do not
drop, silently ignore, or allowlist any request semantic.
