export type Repo = {
  id: string;
  name: string;
  url?: string;
  localPath?: string;
  status: 'cloning' | 'parsing' | 'graph' | 'embedding' | 'summaries' | 'ready' | 'error';
  createdAt: string;
};

export type IndexStatus = {
  stage: 'cloning' | 'parsing' | 'graph' | 'embedding' | 'summaries' | 'ready' | 'error';
  message?: string;
  progress?: number;
};

export type FileNode = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: FileNode[];
};

export type GraphNode = { id: string; label: string; type?: string };
export type GraphEdge = { source: string; target: string; kind: 'import' | 'call' };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type CodeRange = { file: string; start: number; end: number };

export type Citation = { file: string; start: number; end: number };

export type AskResponse = {
  answer: string;
  citations: Citation[];
  confidence: number;
  provider: string;
  model: string;
  cached: boolean;
  not_found: boolean;
};

export type AskStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'meta'; citations: Citation[]; confidence: number; provider: string; model: string; cached: boolean; not_found: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type Finding = {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  file?: string;
  line?: number;
  source: 'design' | 'security' | 'performance' | 'style' | 'bug';
  suggested_fix: string;
  breaks_design?: boolean;
};

export type PRReview = {
  summary: string;
  findings: Finding[];
};

export type Rule = { id: string; name: string; description: string; enabled: boolean };

export type RepairEvent = {
  id: string;
  type: string;
  state: string;
  message: string;
  attempt?: number;
  agent?: 'Architect' | 'Debug' | 'Reviewer' | 'plain';
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
  recentCalls: { id: string; provider: string; model: string; status: string; latencyMs: number; timestamp: string; cached: boolean }[];
};

export type ApiError = { status: number; message: string; code?: string };
