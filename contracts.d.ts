/**
 * astra1-v1: shared contract for the implemented Node ESM runtime.
 * No TypeScript build is required.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
export type Protocol = "anthropic" | "responses";

export type SystemInput =
  | { kind: "absent" }
  | { kind: "string"; text: string }
  | { kind: "sections"; sections: { text: string; cache: boolean }[] };

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string }
  | { type: "reasoning"; text: string; sourceItemId?: string }
  | { type: "tool-call"; callId: string; name: string; namespace?: string; kind: "function" | "tool_search"; input: ObjectValue; owner: "client" | "provider" }
  | { type: "tool-result"; callId: string; parts: ({ type: "text"; text: string } | { type: "image"; data: string; mediaType: string })[]; isError: boolean }
  | { type: "tool-search-result"; callId: string; status: string; execution: "client"; tools: ObjectValue[] };

export type Tool = {
  kind: "function" | "tool_search";
  name: string;
  namespace?: string;
  description?: string;
  schema: ObjectValue;
  execution: "client";
};
export type Turn = {
  protocol: Protocol;
  publicModel: string;
  system: SystemInput;
  messages: { role: "user" | "assistant" | "tool" | "system" | "developer"; parts: Part[] }[];
  tools: Tool[];
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string;
  requestedEffort?: string | null;
  reasoningSummary?: string;
  metadata: Record<string, string>;
};

export type ModelProfile = {
  upstreamModel: string;
  defaultMaxTokens: number;
  maxOutputTokens?: number;
  vision: boolean;
  reasoningText: "none-observed" | "verified";
  efforts: string[];
  effortMap?: Record<"default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string>;
  clientToolSearch: boolean;
  temperatureRange?: [number, number];
};
export type NativeConfig = ObjectValue & {
  workingDir: string; date: string; environment: string; structure: Json[];
  isGitRepo: boolean; currentBranch: string; mainBranch: string; gitStatus: string; recentCommits: Json[];
};
export type Profile = {
  contractVersion: "astra1-v1";
  listen: { host: "127.0.0.1"; port: number };
  auth: { gatewayTokenEnv: string; upstreamKeyEnv: string; sessionSecretEnv: string };
  upstream: {
    baseUrl: string; path: "/alpha/generate"; cliVersion: "1.54.0";
    cliEnvironment: "production"; projectSlug: string; workspaceId: string;
    config: NativeConfig; tasteLearning: boolean; permissionMode: "standard" | "auto-accept" | "plan";
    includeThreadId: boolean; mode?: Json; promptCache?: Json;
    pauseContinuation: { enabled: boolean; maxSegments: 6 };
  };
  models: Record<string, ModelProfile>;
  clients?: { claude: { model: string; effort: string }; codex: { model: string; effort: string } };
  traceMode?: "conversation" | "request";
  limits: {
    requestBytes: number; nativeLineBytes: number; toolArgumentBytes: number;
    turnOutputBytes: number; maxActiveTurns: number; maxSessions: number;
  };
  timeouts: {
    bodyReadMs: number; upstreamHeadersMs: number; upstreamIdleMs: number;
    downstreamStallMs: number; terminalDrainMs: number; preludeMs: number;
    heartbeatMs: number; sessionIdleTtlMs: number;
  };
  prelude: { maxBytes: number; maxEvents: number };
};
export type Identity = { sessionId: string; threadId?: string; traceId?: string };
export type RequestContext = {
  protocol: Protocol; principal: string; upstreamAccount: string; workspaceId: string;
  conversationHint?: string; agentHint?: string;
  anthropicVersion?: string; anthropicBeta?: string;
};
export type Credentials = { upstreamKey: string; gatewayToken: string; sessionSecret: string };
export type ToolBinding = { clientName: string; wireName: string; namespace?: string; kind: Tool["kind"]; schema: ObjectValue };
export type NativeRequest = {
  method: "POST"; url: string; headers: Record<string, string>; body: ObjectValue;
  toolsByWireName: ReadonlyMap<string, ToolBinding>;
};
export type Usage = {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  reasoning?: number; cacheWrite1h?: number;
};
export type FinishReason = "end_turn" | "tool_use" | "max_tokens";
export type BridgeEvent =
  | { type: "upstream-ready"; segment: number }
  | { type: "block-start"; segment: number; blockId: string; kind: "text" | "reasoning" }
  | { type: "block-delta"; segment: number; blockId: string; text: string }
  | { type: "block-end"; segment: number; blockId: string }
  | { type: "tool-start"; segment: number; callId: string; clientName: string; namespace?: string }
  | { type: "tool-delta"; segment: number; callId: string; delta: string }
  | { type: "tool-call"; segment: number; callId: string; clientName: string;
      namespace?: string; kind: Tool["kind"]; input: ObjectValue; rawArguments: string }
  | { type: "finish"; reason: FinishReason; usage: Usage;
      cache: { read: number | null; write: number | null; uncached: number | null } };
// Provider-owned events remain inside the native reducer, never executable egress events.
// Failure is a thrown BridgeError; only encoder.fail() generates a downstream error.
export type BridgeError = Error & {
  code: string; status: number; param?: string; retryable: false;
};
export type ClientEvent = { type: string; [key: string]: Json };
export type Encoder = {
  start(): ClientEvent[];
  push(event: Exclude<BridgeEvent, { type: "upstream-ready" }>): ClientEvent[];
  fail(error: BridgeError): ClientEvent[];
  result(): ObjectValue; // legal only after a validated finish
};

// anthropic.mjs: decodeAnthropic, createAnthropicEncoder, estimateTokens
// responses.mjs: decodeResponses, createResponsesEncoder
export type Decode = (body: unknown, context: RequestContext, profile: Profile) => Turn;
export type CreateEncoder = (turn: Turn, profile: Profile) => Encoder;
// commandcode.mjs: compileNative, parseNativeLines, generate
export type CompileNative = (turn: Turn, profile: Profile, identity: Identity, credentials: Credentials) => NativeRequest;
export type ParseNativeLines = (source: AsyncIterable<Uint8Array>, maxLineBytes: number) => AsyncIterable<ObjectValue>;
export type Generate = (request: NativeRequest, profile: Profile, signal: AbortSignal) => AsyncIterable<BridgeEvent>;
// session.mjs: createSessions().acquire(context)
export type Lease = { identity: Identity; bound: boolean; observePrefix(value: unknown): boolean | null; release(): void };
export type Acquire = (context: RequestContext) => Lease;
