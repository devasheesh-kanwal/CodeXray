// Types for the CodeXray backend API. Source of truth: Backend/docs/API.md.
// Fields the doc marks with `?` (may be null) are typed `T | null`.

export type IndexStage =
  | 'queued' | 'cloning' | 'parsing' | 'graph' | 'bm25' | 'embedding' | 'summaries' | 'ready' | 'failed';

export type Health = { status: string; version: string; mock_mode: boolean; demo_mode: boolean };

export type Repo = { repo_id: string; name: string; status: IndexStage; files_total: number };

export type AddRepoRequest = { git_url: string } | { local_path: string };
export type AddRepoResponse = { repo_id: string; status: IndexStage };

export type IndexStatus = {
  stage: IndexStage;
  files_done: number;
  files_total: number;
  error: string | null;
  chunks_total: number | null;
  chunks_embedded: number | null;
  search_mode: 'hybrid' | 'bm25_only' | null;
};

export type CodeSymbol = {
  name: string;
  kind: 'class' | 'function' | 'method';
  start_line: number;
  end_line: number;
  children: CodeSymbol[];
};

export type TreeNode = {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: TreeNode[];
  symbols: CodeSymbol[];
};

export type TreeResponse = { repo_id: string; root: TreeNode };

export type GraphNode = { id: string; label: string; type: 'file' | 'class' | 'function'; file: string };
export type GraphEdge = { source: string; target: string; type: 'imports' | 'contains' | 'calls' };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type FileSlice = { path: string; start: number; end: number; lines: string[] };

export type AgentTraceStep = { agent: string; step: number; action: string; summary: string; ms: number };

export type Citation = { file: string; start_line: number; end_line: number; why: string };

export type AskResponse = {
  answer: string;
  citations: Citation[];
  confidence: number;
  not_found: boolean;
  provider: string;
  model: string;
  cached: boolean;
  agent_trace: AgentTraceStep[] | null;
};

export type AskFinal = Omit<AskResponse, 'answer' | 'cached'> & { cached?: boolean };

export type AskStreamEvent =
  | { event: 'agent'; data: { agent: string; status: 'running' | 'done' | 'failed'; detail?: string | null } }
  | { event: 'token'; data: { text: string } }
  | { event: 'final'; data: AskFinal }
  | { event: 'done'; data: Record<string, never> }
  | { event: 'error'; data: ErrorBody };

export type Finding = {
  id: string;
  category: 'bug' | 'security' | 'practice' | 'design';
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line: number;
  title: string;
  explanation: string;
  suggested_fix: string;
  source: 'llm' | 'ruff' | 'bandit' | 'rule';
  confidence: number;
};

export type ReviewRequest = { diff_text: string } | { base_branch: string; head_branch: string };

export type ReviewResponse = { summary: string; findings: Finding[]; agent_trace: AgentTraceStep[] | null };

export type Rule = {
  id: string;
  title: string;
  description: string;
  severity: Finding['severity'];
  enabled: boolean;
};

export type RulesResponse = { rules: Rule[] };

export type RepairState =
  | 'CREATED' | 'BASELINE' | 'PLANNING' | 'BRANCHED' | 'REPRODUCING' | 'DIAGNOSING' | 'PATCHING' | 'TESTING'
  | 'EVALUATING' | 'REVIEWING' | 'AWAITING_APPROVAL' | 'MERGED' | 'REJECTED' | 'FAILED' | 'CLEANUP';

export type RepairEvent = {
  ts: string;
  state: RepairState;
  attempt: number;
  agent: string | null;
  kind: 'state' | 'agent' | 'tests' | 'eval' | 'note' | 'error';
  message: string;
  data: Record<string, unknown>;
};

export type EvalCheck = { name: string; passed: boolean; detail: string };

/** The test CodeXray wrote when no existing test showed the bug; the fix is judged against it. */
export type ReproTest = { path: string; code: string };

export type RepairRun = {
  state: RepairState;
  attempt: number;
  max_attempts: number;
  diff: string | null;
  eval: { checks: EvalCheck[] } | null;
  reviewer_notes: string | null;
  root_cause: string | null;
  repro_test: ReproTest | null;
  events: RepairEvent[];
};

export type RepairRequest = { issue: string; test_command?: string };
export type RepairStartResponse = { run_id: string };

export type ProviderStatus = {
  name: string;
  state: 'available' | 'cooldown' | 'no_keys' | 'disabled';
  cooldown_until: string | null;
};

export type LLMCall = {
  lane: string;
  provider: string;
  model: string;
  ok: boolean;
  switch_reason: string | null;
  latency_ms: number;
  cached: boolean;
};

export type LLMStatus = { providers: ProviderStatus[]; recent_calls: LLMCall[] };

/** GET /api/llm/models: every model the agents can use, and which one is picked. */
export type ModelState = 'available' | 'cooldown' | 'no_keys' | 'disabled' | 'unavailable';
export type ModelInfo = {
  id: string; // "provider/model", the value for PUT /api/llm/selection
  provider: string;
  model: string;
  max_context: number;
  lanes: string[];
  state: ModelState;
  cooldown_until: string | null;
};
export type ModelsResponse = { mode: 'auto' | 'manual'; selected: string | null; models: ModelInfo[] };

export type EmbeddingProviderId = 'gemini' | 'nvidia';
export type EmbeddingsResponse = {
  enabled: boolean;
  selected: EmbeddingProviderId;
  providers: { id: EmbeddingProviderId; label: string; model: string; available: boolean }[];
  adding_vectors: string[];
};

export type ErrorBody = { code: string; message: string; details: Record<string, unknown> };
