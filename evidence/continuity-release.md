# Streaming / session / cache — 2026-09-15

## Scope and method

Real installed Claude Code CLI 2.1.272, `--bare -p --output-format stream-json --verbose
--include-partial-messages`, two ordered Read calls in demos/snake, then a text
response. Account checked using whoami: deizermonokixhtf. Configured model:
meta/muse-spark-1.3-contributor. No Snake code changed by these probes.

`scripts/probe-continuity.mjs` observes native HTTP arrivals, bridge SSE writes,
and CLI stdout arrivals using one process clock. It retains counts, timing,
usage and equality booleans; no credentials, prompt, tool input or session IDs.
Each run completed with three HTTP 200 native requests, CLI exit 0 and PROBE_DONE.
Both runs also observed one unrelated non-generation `not_found` route; it did
not fail the inference. Interactive terminal repaint and Command Code dashboard
grouping were not measured.

## Results

| Measurement | Before | After |
|---|---:|---:|
| Final request: first native text after request start | 15,619 ms | 13,158 ms |
| Native text deltas | 28 | 22 |
| First-to-last text duration | 846 ms | 764 ms |
| Maximum native-to-bridge delta lag | 1 ms | 1 ms |
| Maximum native-to-CLI stdout delta lag | 8 ms | 7 ms |
| Session and thread same across all three calls | yes | yes |
| model/config/system/tools unchanged between calls | yes | yes |
| Reported cache reads by request | 113 / 113 / 1,137 | 113 / 753 / 2,033 |

Text already streamed before this change. Most perceived delay was before the
first native text. Counts alone in the earlier Snake report did not establish
timely delivery. The Snake harness also suppressed partial text on its console.
Tool argument buffering remains intentional until validated terminal tool-call;
this is separate from text streaming and may make a generated file appear at once.

Cache read improvement between runs is not proof that the code change improved
cache efficiency: the upstream cache can warm between runs. The latest final
request reports 2,033 read tokens of 2,073 input tokens (98.1%) and 40 uncached.
Cache write count was not reported, so new diagnostics show null, not zero.

Different traces do not imply different sessions. Static installed CLI 1.54.0:
`buildCommandAuthHeaders` supplies x-session-id; `startIterationSpan` creates a
new root with a link to the previous iteration; `startChatSpan` creates its HTTP
traceparent. Astra1 currently does not export these native telemetry spans/links
or synthesize a conversation-wide traceparent. Its native session and thread
headers/body were verified equal, not inferred from dashboard appearance.

## Changes and validation

- Explicit conversation bindings now derive separate keyed UUIDv8 session/thread
  identities. TTL/restart no longer rotates them. Changed secret/account/workspace/
  protocol/conversation/agent remains isolated. Requests without a hint remain
  independent. Deploying this replaces pre-existing random identities once.
- Content-free request metrics expose stream timing, text count, conversation
  binding, static prefix equality and source-reported cache counters.
- Missing counters stay unknown in diagnostics. Existing protocol usage unchanged.
- 47 offline tests passed, including real HTTP gates proving text reaches each
  protocol client before the next native delta and before completion, TTL/restart
  identity continuity and isolation, and unknown-vs-zero cache reporting.
- Live after-change test verified upstream accepts the derived identities and
  actual Claude tool-result round trips remain successful.
- Foundation integrity check passed. The main service on 127.0.0.1:8742 was
  restarted with the change after confirming zero active turns.

Raw sanitized evidence: [before](continuity-before.json), [after](continuity-after.json).
