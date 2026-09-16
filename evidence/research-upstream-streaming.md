# Upstream streaming reference review — 2026-09-16

Scope: read-only review for the slow/blocky-streaming report. No runtime code
was copied or changed by this review.

## Source status

GitHub repository pages were accessed through web search for all seven named
repositories. `git ls-remote` also verified the current default-branch HEAD
for each on 2026-09-16. Code-level claims below come from the local snapshots,
not a claim that every current GitHub HEAD has identical code.

| Repository | Local code revision examined | Live default-branch HEAD verified |
|---|---|---|
| MAXeaglet/commandcode-proxy | `6b845b6f169170b6164b71bfacdd9cb2b762ce39` | `9bdfafcb17ad0417eaf8600e830109d11084e6d7` |
| proxy-turkey/CommandCodeBridge | `118838194f30c1ed989d8c659584bba503c99ce1` | same |
| dev2k6/command-code-proxy-server | `4f4279431d672612388e16619783d9e7536cad9e` | same |
| liwei/commandcode-proxy-go | `d7eff1ccdb66266f10ae240961e41a530cc45d37` | `e17f53af86fbae5d557a1fef69bede1328faf052` |
| Khip01/commandcode-bridge | `38c1eea9992fe619cf7be343d0b534f1e0614ffe` | same |
| decolua/9router | `17c4cc76877bd1755030a8414f8d0083f48dcccf` | same |
| diegosouzapw/OmniRoute | unversioned local `omniroute-20260914` extract | `e7214c72fc9d16d388fb67db2dc20c97b270adbf` |

## Astra1 finding

The current prelude already commits immediately on the first non-empty
`block-delta`, including a **reasoning** delta. It therefore does **not** delay
the first text delta once a non-empty block delta has arrived. The current
change also commits on client `tool-start`/`tool-delta`, fixing the previous
NativeReducer behavior that kept `tool-input-start` and `tool-input-delta`
until the terminal `tool-call`.

The evidence does not support generic SSE frame coalescing. Keep one native
text/tool fragment per downstream semantic event. The remaining possibilities
for visibly large text blocks are: upstream itself emits large `text-delta`
values, a downstream intermediary buffers SSE, or the client renderer batches
its display. They require timestamps at native-receipt and downstream-write
boundaries to distinguish.

## Reference-specific parser and tool handling

| Local snapshot | Parser / framing behavior | Tool-start/delta/end behavior | Useful boundary |
|---|---|---|---|
| [MAXeaglet @ 6b845b6](https://github.com/MAXeaglet/commandcode-proxy/tree/6b845b6f169170b6164b71bfacdd9cb2b762ce39) | `TextDecoder`, retained unfinished newline-framed data, per-translated-event write, and downstream `drain`; SSE headers disable proxy buffering. | Its translator treats terminal `tool-call` as the visible OpenAI tool chunk; native tool-input fragments are silent in that snapshot. | Take byte-safe framing/backpressure headers, not its terminal-only tool behavior. |
| [liwei @ d7eff1c](https://github.com/liwei/commandcode-proxy-go/tree/d7eff1ccdb66266f10ae240961e41a530cc45d37) | `bufio.Reader.ReadString('\\n')`, including a trailing EOF line; separates pre-visible decisive events from later output. | Tool call is a decisive content event; this snapshot does not provide a richer native tool-fragment renderer. | Keep trailing-line parsing and pre-commit distinction; not its pre-content POST retry policy. |
| [proxy-turkey @ 1188381](https://github.com/proxy-turkey/CommandCodeBridge/tree/118838194f30c1ed989d8c659584bba503c99ce1) | Bounded `bufio.Scanner` feeds an asynchronous line channel, then writes `event:` + `data:` + blank line. | `ParseLine` provides the translation layer; the stream scanner itself preserves line ordering. | A line/idle boundary must not be considered a successful terminal state. |
| [dev2k6 @ 4f42794](https://github.com/dev2k6/command-code-proxy-server/tree/4f4279431d672612388e16619783d9e7536cad9e) | 1 MiB bounded scanner and `http.Flusher.Flush()` after every emitted SSE record. | `tool-input-start` allocates an output tool index keyed by native ID; `tool-input-delta` emits argument fragments at that same ID/index; terminal `tool-call` is suppressed if that ID was already streamed. This supports interleaved calls. | Astra1's map-by-call-ID start/delta/terminal validation follows the useful part. Do not emit successful finish/[DONE] at raw `finish` before validated tail + EOF. |
| [Khip01 @ 38c1eea](https://github.com/Khip01/commandcode-bridge/tree/38c1eea9992fe619cf7be343d0b534f1e0614ffe) | Local snapshot was inspected only for repository layout; no parser-specific conclusion was used. | No claim. | Do not infer wire behavior from its dashboard/TUI. |
| [9router @ 17c4cc7](https://github.com/decolua/9router/tree/17c4cc76877bd1755030a8414f8d0083f48dcccf) | Per-stream `TextDecoder`, line buffer, decoder drain in transform `flush`; raw upstream bytes reset the stall watchdog. | Its shared translation state maintains tool-call state across streaming chunks and is accompanied by tests for parallel tool calls. The local generic converter is too broad to treat as Command Code's exact tool-input protocol. | Take raw-byte idle measurement and stable per-call state; do not adopt generic usage estimation or provider-specific policy. |
| [OmniRoute local extract](https://github.com/diegosouzapw/OmniRoute) | `TextDecoder`, buffer across reads, final non-newline processing, one SSE enqueue per decoded event. | The Command Code fallback renders terminal tool calls as complete items; it does not establish a better source for native tool-input fragment forwarding. | Do not adopt its clean terminal + `[DONE]` on EOF without native `finish`; Astra1 correctly calls that truncated. |

## Required transport behavior

The current `server.mjs` change sets `Content-Type: text/event-stream`,
`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, then calls
`res.flushHeaders()` before writing queued frames. Each frame still uses the
existing `writeFrame` / `drain` handling. This is the correct place to rule out
Node/proxy header buffering; it does not split an upstream-provided large delta.

## Verification target

Keep byte-split UTF-8/NDJSON tests. Add a timing-only probe that records request
start, native first `text-delta`/`tool-input-delta`, server first corresponding
SSE write, and client first data-frame receipt. Record types/counts/times only,
never prompt, output, tool arguments, IDs, or credentials.
