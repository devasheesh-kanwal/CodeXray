// Fixtures for VITE_USE_MOCK=true, in the same shapes as Backend/docs/API.md.
import type {
  AskResponse, GraphData, IndexStatus, LLMStatus, Repo, RepairEvent, RepairRun,
  ReviewResponse, RulesResponse, TreeResponse,
} from '../types';

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockRepos: Repo[] = [
  { repo_id: 'repo_flask_todo', name: 'flask-todo', status: 'ready', files_total: 7 },
];

export const mockStatus: IndexStatus = {
  stage: 'ready', files_done: 7, files_total: 7, error: null,
  chunks_total: 19, chunks_embedded: 19, search_mode: 'hybrid',
};

export const mockFiles: Record<string, string[]> = {
  'app/auth.py': [
    'from functools import wraps',
    'from flask import abort, current_app, g, request',
    '',
    '',
    '',
    'def verify_token(token):',
    '    """Return the user name for a valid API token, else None."""',
    '    tokens = current_app.config["API_TOKENS"]',
    '    return tokens.get(token)',
    '',
    '',
    'def login_required(view):',
    '    @wraps(view)',
    '    def wrapper(*args, **kwargs):',
    '        header = request.headers.get("Authorization", "")',
    '        token = header.removeprefix("Bearer ").strip()',
    '        user = verify_token(token)',
    '        if user is None:',
    '            abort(401)',
    '        g.user = user',
    '        return view(*args, **kwargs)',
    '',
    '    return wrapper',
  ],
  'app/models.py': [
    'from dataclasses import dataclass',
    '',
    '',
    '@dataclass',
    'class Todo:',
    '    id: int',
    '    owner: str',
    '    title: str',
    '    done: bool',
    '',
    '    @classmethod',
    '    def from_row(cls, row):',
    '        return cls(row["id"], row["owner"], row["title"], bool(row["done"]))',
    '',
    '    def to_dict(self):',
    '        return {"id": self.id, "title": self.title, "done": self.done}',
  ],
};

export const mockTree: TreeResponse = {
  repo_id: 'repo_flask_todo',
  root: {
    name: 'flask-todo', path: '', type: 'folder', symbols: [],
    children: [{
      name: 'app', path: 'app', type: 'folder', symbols: [],
      children: [
        {
          name: 'auth.py', path: 'app/auth.py', type: 'file', children: [],
          symbols: [
            { name: 'verify_token', kind: 'function', start_line: 6, end_line: 9, children: [] },
            { name: 'login_required', kind: 'function', start_line: 12, end_line: 23, children: [] },
          ],
        },
        {
          name: 'models.py', path: 'app/models.py', type: 'file', children: [],
          symbols: [{
            name: 'Todo', kind: 'class', start_line: 4, end_line: 16,
            children: [
              { name: 'from_row', kind: 'method', start_line: 11, end_line: 13, children: [] },
              { name: 'to_dict', kind: 'method', start_line: 15, end_line: 16, children: [] },
            ],
          }],
        },
      ],
    }],
  },
};

export const mockGraph: GraphData = {
  nodes: [
    { id: 'file:app/auth.py', label: 'app/auth.py', type: 'file', file: 'app/auth.py' },
    { id: 'file:app/models.py', label: 'app/models.py', type: 'file', file: 'app/models.py' },
    { id: 'func:app/auth.py:verify_token', label: 'verify_token', type: 'function', file: 'app/auth.py' },
    { id: 'func:app/auth.py:login_required', label: 'login_required', type: 'function', file: 'app/auth.py' },
    { id: 'class:app/models.py:Todo', label: 'Todo', type: 'class', file: 'app/models.py' },
  ],
  edges: [
    { source: 'file:app/auth.py', target: 'func:app/auth.py:verify_token', type: 'contains' },
    { source: 'file:app/auth.py', target: 'func:app/auth.py:login_required', type: 'contains' },
    { source: 'file:app/models.py', target: 'class:app/models.py:Todo', type: 'contains' },
    { source: 'func:app/auth.py:login_required', target: 'func:app/auth.py:verify_token', type: 'calls' },
    { source: 'file:app/auth.py', target: 'file:app/models.py', type: 'imports' },
  ],
};

const NOT_FOUND = 'No relevant code found for this question';

export function mockAsk(question: string): AskResponse {
  if (!/auth|login|token|user/i.test(question)) {
    return {
      answer: NOT_FOUND, citations: [], confidence: 0, not_found: true,
      provider: 'mock', model: 'mock-model', cached: false, agent_trace: null,
    };
  }
  return {
    answer: 'Every todo endpoint is wrapped in the login_required decorator [app/auth.py:12-23]. '
      + 'It reads the bearer token and looks it up with verify_token [app/auth.py:6-9]; '
      + 'unknown tokens get a 401, otherwise the user name is stored in g.user.',
    citations: [
      { file: 'app/auth.py', start_line: 12, end_line: 23, why: 'Defines login_required.' },
      { file: 'app/auth.py', start_line: 6, end_line: 9, why: 'verify_token maps a token to a user.' },
    ],
    confidence: 0.9, not_found: false, provider: 'mock', model: 'mock-model', cached: false,
    agent_trace: [
      { agent: 'architect', step: 1, action: 'search_code', summary: 'Found login_required and verify_token.', ms: 410 },
      { agent: 'explainer', step: 2, action: 'read_file', summary: 'Read app/auth.py and wrote the answer.', ms: 2380 },
      { agent: 'citation_checker', step: 3, action: 'verify_citations', summary: '2 of 2 citations verified.', ms: 15 },
    ],
  };
}

export const mockReview: ReviewResponse = {
  summary: 'The diff adds a payment helper that builds SQL with an f-string and opens SQLite directly. 1 critical, 1 medium.',
  findings: [
    {
      id: 'F1', category: 'security', severity: 'critical', file: 'library/loans.py', line: 46,
      title: 'SQL query built with an f-string',
      explanation: 'member_id and amount are interpolated straight into the SQL string, allowing SQL injection.',
      suggested_fix: 'conn.execute("UPDATE members SET balance = balance + ? WHERE id = ?", (amount, member_id))',
      source: 'bandit', confidence: 0.95,
    },
    {
      id: 'F2', category: 'design', severity: 'medium', file: 'library/loans.py', line: 45,
      title: 'Database opened outside the data layer',
      explanation: 'The loans module now talks to SQLite directly, which breaks the existing module boundaries.',
      suggested_fix: 'Move persistence into a dedicated module and call it from loans.py.',
      source: 'rule', confidence: 0.8,
    },
  ],
  agent_trace: [{ agent: 'architect', step: 1, action: 'map_impact', summary: 'Diff touches library/loans.py only.', ms: 640 }],
};

export const mockRules: RulesResponse = {
  rules: [
    { id: 'R1', title: 'Parameterized SQL only', description: 'Never build SQL strings with f-strings or concatenation.', severity: 'high', enabled: true },
    { id: 'R2', title: 'Database access in one module', description: 'Open database connections only from the data layer.', severity: 'low', enabled: true },
  ],
};

const t0 = Date.now();
const ev = (i: number, state: RepairEvent['state'], attempt: number, agent: string, kind: RepairEvent['kind'], message: string, data: Record<string, unknown> = {}): RepairEvent =>
  ({ ts: new Date(t0 + i * 1500).toISOString(), state, attempt, agent, kind, message, data });

export const mockRepairEvents: RepairEvent[] = [
  ev(0, 'CREATED', 1, 'coordinator', 'state', 'Repair run created.'),
  ev(1, 'BASELINE', 1, 'test_runner', 'tests', 'Baseline: 1 passed, 1 failed (the failure reproduces the issue).', { passed: 1, failed: 1 }),
  ev(2, 'PLANNING', 1, 'architect', 'agent', 'Found delete_todo in app/routes.py.'),
  ev(3, 'BRANCHED', 1, 'coordinator', 'state', 'Created branch codexray/fix-run_mock.'),
  ev(4, 'DIAGNOSING', 1, 'debugger', 'agent', 'Root cause: fetchone() result is never checked.'),
  ev(5, 'PATCHING', 1, 'repair', 'agent', 'Wrote a 2-line patch.'),
  ev(6, 'TESTING', 1, 'test_runner', 'tests', 'All tests pass (2/2).', { passed: 2, failed: 0 }),
  ev(7, 'EVALUATING', 1, 'eval_gate', 'eval', 'All eval checks passed.'),
  ev(8, 'REVIEWING', 1, 'reviewer', 'agent', 'Verdict: approve, risk: low.'),
  ev(9, 'AWAITING_APPROVAL', 1, 'coordinator', 'state', 'Waiting for human approval.'),
];

export const mockRepairRun: RepairRun = {
  state: 'AWAITING_APPROVAL', attempt: 1, max_attempts: 3,
  diff: '--- a/app/routes.py\n+++ b/app/routes.py\n@@ -38,6 +38,8 @@\n     ).fetchone()\n+    if row is None:\n+        abort(404, description="todo not found")\n     todo = Todo.from_row(row)\n',
  eval: {
    checks: [
      { name: 'target_test_passes', passed: true, detail: 'The failing test now passes.' },
      { name: 'no_regressions', passed: true, detail: 'All baseline tests still pass.' },
      { name: 'no_test_files_changed', passed: true, detail: 'Only app/routes.py changed.' },
    ],
  },
  reviewer_notes: 'The fix handles the missing row at the right place.',
  root_cause: 'delete_todo never checks the result of fetchone(), so a missing todo raises TypeError (500).',
  repro_test: null,
  events: mockRepairEvents,
};

export const mockLLMStatus: LLMStatus = {
  providers: [
    { name: 'groq', state: 'cooldown', cooldown_until: new Date(Date.now() + 45000).toISOString() },
    { name: 'nvidia', state: 'available', cooldown_until: null },
    { name: 'deepseek', state: 'no_keys', cooldown_until: null },
  ],
  recent_calls: [
    { lane: 'qa', provider: 'groq', model: 'llama-3.3-70b-versatile', ok: false, switch_reason: null, latency_ms: 310, cached: false },
    { lane: 'qa', provider: 'nvidia', model: 'meta/llama-3.1-70b-instruct', ok: true, switch_reason: 'groq rate limited (429); cooling down for 60 s', latency_ms: 4120, cached: false },
  ],
};
