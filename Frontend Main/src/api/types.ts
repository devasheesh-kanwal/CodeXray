export type Repo = {
  id: string;
  name: string;
  url?: string;
  localPath?: string;
  status: 'cloning' | 'parsing' | 'graph' | 'embedding' | 'summaries' | 'ready' | 'error';
  filesDone?: number;
  totalFiles?: number;
  createdAt: string;
};

export type IndexStatus = {
  stage: 'cloning' | 'parsing' | 'graph' | 'embedding' | 'summaries' | 'ready' | 'error';
  message?: string;
  progress?: number;
  filesDone?: number;
  totalFiles?: number;
};

export type CodeSymbol = {
  name: string;
  kind: 'function' | 'class';
  startLine: number;
  endLine: number;
};

export type FileNode = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  symbols?: CodeSymbol[];
  children?: FileNode[];
};

export type GraphNode = { id: string; label: string; type?: string };
export type GraphEdge = { source: string; target: string; kind: 'import' | 'call' };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type CodeRange = { file: string; start: number; end: number };

export type Citation = { file: string; start: number; end: number };

export type AgentStep = {
  agent: string;
  action: string;
  durationMs?: number;
};

export type AskResponse = {
  answer: string;
  citations: Citation[];
  confidence: number;
  provider: string;
  model: string;
  cached: boolean;
  not_found: boolean;
  steps?: AgentStep[];
};

export type AskStreamEvent =
  | { type: 'agent_status'; agent: string; status: string }
  | { type: 'token'; text: string }
  | { type: 'meta'; citations: Citation[]; confidence: number; provider: string; model: string; cached: boolean; not_found: boolean; steps?: AgentStep[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type Finding = {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  file?: string;
  line?: number;
  source: 'design' | 'security' | 'performance' | 'style' | 'bug' | 'practice';
  suggested_fix: string;
  breaks_design?: boolean;
};

export type PRReview = {
  summary: string;
  counts?: {
    bug: number;
    security: number;
    practice: number;
    design: number;
  };
  findings: Finding[];
};

export type Rule = { id: string; name: string; description: string; enabled: boolean };

export type RepairEvent = {
  id: string;
  type: string;
  state: string;
  message: string;
  attempt?: number;
  agent?: 'Architect' | 'Debug' | 'Reviewer' | 'plain' | 'Test Runner';
  status: 'running' | 'pass' | 'fail' | 'pending' | 'merged' | 'deleted';
  timestamp: string;
  diff?: string;
  eval?: { name: string; pass: boolean }[];
  reviewerOpinion?: string;
};

export type RepairRun = {
  id: string;
  repoId: string;
  status: 'running' | 'awaiting_approval' | 'merged' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  issueDescription?: string;
  rootCause?: string;
  events: RepairEvent[];
  replay?: boolean;
};

export type ProviderStatus = {
  name: string;
  status: 'ok' | 'cooldown' | 'disabled';
  cooldownUntil?: string;
  model?: string;
};

export type LLMStatus = {
  activeModel: string;
  providers: ProviderStatus[];
  recentCalls: { id: string; provider: string; model: string; status: string; latencyMs: number; timestamp: string; cached: boolean; switched?: boolean }[];
};

export type ApiError = { status: number; message: string; code?: string };

