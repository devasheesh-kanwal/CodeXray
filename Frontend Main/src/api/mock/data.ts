import type { Repo, IndexStatus, FileNode, GraphData, AskResponse, PRReview, Rule, RepairRun, LLMStatus } from '../types';

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockRepos: Repo[] = [
  { id: 'r1', name: 'codesense-backend', url: 'https://github.com/example/codesense-backend.git', status: 'ready', filesDone: 42, totalFiles: 42, createdAt: '2026-10-20T10:00:00Z' },
  { id: 'r2', name: 'my-frontend', localPath: '/Users/dev/my-frontend', status: 'embedding', filesDone: 18, totalFiles: 36, createdAt: '2026-10-21T12:00:00Z' },
];

export const mockTree: FileNode = {
  path: '', name: 'root', type: 'dir', children: [
    { path: 'src', name: 'src', type: 'dir', children: [
      { path: 'src/api', name: 'api', type: 'dir', children: [
        {
          path: 'src/api/client.ts',
          name: 'client.ts',
          type: 'file',
          symbols: [
            { name: 'ApiError', kind: 'class', startLine: 7, endLine: 13 },
            { name: 'apiFetch()', kind: 'function', startLine: 15, endLine: 30 },
            { name: 'streamPost()', kind: 'function', startLine: 32, endLine: 72 },
            { name: 'subscribeEvents()', kind: 'function', startLine: 74, endLine: 97 },
          ],
        },
        {
          path: 'src/api/types.ts',
          name: 'types.ts',
          type: 'file',
          symbols: [
            { name: 'Repo', kind: 'class', startLine: 1, endLine: 8 },
            { name: 'IndexStatus', kind: 'class', startLine: 10, endLine: 16 },
            { name: 'FileNode', kind: 'class', startLine: 25, endLine: 31 },
          ],
        },
      ]},
      {
        path: 'src/index.ts',
        name: 'index.ts',
        type: 'file',
        symbols: [
          { name: 'main()', kind: 'function', startLine: 3, endLine: 6 },
        ],
      },
      {
        path: 'src/Button.tsx',
        name: 'Button.tsx',
        type: 'file',
        symbols: [
          { name: 'Button()', kind: 'function', startLine: 4, endLine: 18 },
        ],
      },
      {
        path: 'src/Form.tsx',
        name: 'Form.tsx',
        type: 'file',
        symbols: [
          { name: 'Form()', kind: 'function', startLine: 4, endLine: 22 },
        ],
      },
    ]},
    {
      path: 'auth',
      name: 'auth',
      type: 'dir',
      children: [
        {
          path: 'auth/login.py',
          name: 'login.py',
          type: 'file',
          symbols: [
            { name: 'UserSession', kind: 'class', startLine: 4, endLine: 11 },
            { name: 'authenticate_user()', kind: 'function', startLine: 12, endLine: 30 },
          ],
        },
      ],
    },
    { path: 'package.json', name: 'package.json', type: 'file' },
    { path: 'README.md', name: 'README.md', type: 'file' },
  ],
};

export const mockGraph: GraphData = {
  nodes: [
    { id: 'src/index.ts', label: 'index.ts' },
    { id: 'src/api/client.ts', label: 'client.ts' },
    { id: 'src/api/types.ts', label: 'types.ts' },
    { id: 'auth/login.py', label: 'login.py' },
    { id: 'src/Button.tsx', label: 'Button.tsx' },
  ],
  edges: [
    { source: 'src/index.ts', target: 'src/api/client.ts', kind: 'import' },
    { source: 'src/api/client.ts', target: 'src/api/types.ts', kind: 'import' },
    { source: 'src/index.ts', target: 'src/Button.tsx', kind: 'import' },
    { source: 'src/api/client.ts', target: 'auth/login.py', kind: 'call' },
  ],
};

export const mockFileContent: Record<string, string> = {
  'src/index.ts': `import { apiFetch } from './api/client';
import { Button } from './Button';

export function main() {
  console.log('CodeXray application initialized');
  return { status: 'running' };
}
`,
  'src/api/client.ts': `import { mockFetch, mockStreamPost } from './mock';
import type { AskStreamEvent } from './types';

const USE_MOCK = true;
const BASE = 'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, options);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
}

export async function streamPost(
  path: string,
  body: unknown,
  onEvent: (e: AskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(BASE + path, { method: 'POST', body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw new ApiError(res.status, 'Stream error');
  // Streaming reader parses incoming NDJSON frames
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
}

export function subscribeEvents(path: string) {
  return new EventSource(BASE + path);
}
`,
  'src/api/types.ts': `export type Repo = { id: string; name: string; status: string; };
export type IndexStatus = { stage: string; filesDone?: number; totalFiles?: number; };
export type FileNode = { path: string; name: string; type: 'file' | 'dir'; };
`,
  'auth/login.py': `import hashlib
import time

class UserSession:
    def __init__(self, username: str, token: str):
        self.username = username
        self.token = token
        self.created_at = time.time()

def authenticate_user(username: str, password_hash: str) -> UserSession:
    """Authenticates credentials against repository store and mints session token."""
    if not username or not password_hash:
        raise ValueError("Missing username or credentials")
    
    # In-memory session minting
    session_secret = hashlib.sha256(f"{username}:{password_hash}".encode()).hexdigest()
    return UserSession(username=username, token=session_secret)
`,
  'src/Button.tsx': `import React from 'react';

export function Button({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ backgroundColor: '#ff5500', color: '#ffffff' }}
      className="px-4 py-2 rounded-lg font-medium"
    >
      {label}
    </button>
  );
}
`,
  'src/Form.tsx': `import React, { useState } from 'react';

export function Form({ onSubmit }: { onSubmit: (data: any) => void }) {
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Vulnerability: Missing input validation on email field
    onSubmit({ email });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Submit</button>
    </form>
  );
}
`,
};

export const mockAskResponse = (q: string): AskResponse => {
  const lower = q.toLowerCase();
  if (lower.includes('auth') || lower.includes('login')) {
    return {
      answer: `User login authentication is handled in \`auth/login.py\`. 

The function \`authenticate_user()\` validates the user credentials and mints a cryptographically hashed \`UserSession\` token:

\`\`\`python
session_secret = hashlib.sha256(f"{username}:{password_hash}".encode()).hexdigest()
return UserSession(username=username, token=session_secret)
\`\`\`

See [auth/login.py:12-30] for the core authentication logic and session parameters.`,
      citations: [{ file: 'auth/login.py', start: 12, end: 30 }],
      confidence: 0.94,
      provider: 'openai',
      model: 'gpt-4o-mini',
      cached: false,
      not_found: false,
      steps: [
        { agent: 'Architect', action: 'Scanned AST call graph for authentication references', durationMs: 140 },
        { agent: 'Retriever', action: 'Matched symbols `UserSession` and `authenticate_user` in auth/login.py', durationMs: 220 },
        { agent: 'Synthesizer', action: 'Synthesized implementation overview with verified citations', durationMs: 310 },
      ],
    };
  }

  if (lower.includes('api') || lower.includes('client')) {
    return {
      answer: `The API client is implemented in \`src/api/client.ts\`. It exports \`apiFetch\` for standard REST calls, \`streamPost\` for token streaming, and \`subscribeEvents\` for Server-Sent Events.

See [src/api/client.ts:15-30] for request handling and error propagation.`,
      citations: [{ file: 'src/api/client.ts', start: 15, end: 30 }],
      confidence: 0.88,
      provider: 'openai',
      model: 'gpt-4o-mini',
      cached: true,
      not_found: false,
      steps: [
        { agent: 'Architect', action: 'Looked up client module exports in symbol table', durationMs: 95 },
        { agent: 'Retriever', action: 'Retrieved function signatures for `apiFetch` and `streamPost`', durationMs: 180 },
        { agent: 'Synthesizer', action: 'Generated structural summary with line citations', durationMs: 250 },
      ],
    };
  }

  if (lower.includes('entry') || lower.includes('start') || lower.includes('main')) {
    return {
      answer: `The primary entry point is \`src/index.ts\` which exposes the \`main()\` bootstrap function.

See [src/index.ts:1-6].`,
      citations: [{ file: 'src/index.ts', start: 1, end: 6 }],
      confidence: 0.82,
      provider: 'openai',
      model: 'gpt-4o-mini',
      cached: false,
      not_found: false,
      steps: [
        { agent: 'Architect', action: 'Parsed root dependency tree', durationMs: 110 },
        { agent: 'Synthesizer', action: 'Extracted entry bootstrap function', durationMs: 190 },
      ],
    };
  }

  // Not found scenario
  return {
    answer: 'No relevant code found in this repository for the given query.',
    citations: [],
    confidence: 0.15,
    provider: 'openai',
    model: 'gpt-4o-mini',
    cached: false,
    not_found: true,
    steps: [
      { agent: 'Architect', action: 'Searched symbol index and AST without matching keywords', durationMs: 350 },
      { agent: 'Retriever', action: 'Confidence below retrieval threshold (0.20)', durationMs: 120 },
    ],
  };
};

export const mockPRReview: PRReview = {
  summary: '4 findings identified across 2 files: 1 Bug, 1 Security, 1 Practice, 1 Design violation.',
  counts: {
    bug: 1,
    security: 1,
    practice: 1,
    design: 1,
  },
  findings: [
    {
      id: 'f1',
      severity: 'high',
      title: 'Breaks project design - Button color deviates from design system token',
      description: 'The button element uses an inline hex color (#ff5500) rather than the standard `--accent` (#3164f4) token.',
      file: 'src/Button.tsx',
      line: 7,
      source: 'design',
      suggested_fix: 'Replace `style={{ backgroundColor: "#ff5500" }}` with `bg-accent` class',
      breaks_design: true,
    },
    {
      id: 'f2',
      severity: 'high',
      title: 'Missing input validation on email field',
      description: 'User input is passed directly to the submit callback without sanitation or RFC 5322 regex checks.',
      file: 'src/Form.tsx',
      line: 9,
      source: 'security',
      suggested_fix: 'const isValidEmail = (e: string) => /^\\S+@\\S+\\.\\S+$/.test(e);',
    },
    {
      id: 'f3',
      severity: 'medium',
      title: 'Uncaught promise rejection in stream reader',
      description: 'While reading the incoming chunk stream, cancellation throws an unhandled DOMException.',
      file: 'src/api/client.ts',
      line: 38,
      source: 'bug',
      suggested_fix: 'wrap `reader.read()` in a try/catch and handle `AbortError` gracefully',
    },
    {
      id: 'f4',
      severity: 'low',
      title: 'Missing error boundary around high-frequency code viewer',
      description: 'Syntax highlighters can throw on malformed input chunks; wrap in an React ErrorBoundary.',
      file: 'src/index.ts',
      line: 4,
      source: 'practice',
      suggested_fix: '<ErrorBoundary fallback={<Fallback />}>{children}</ErrorBoundary>',
    },
  ],
};

export const mockRules: Rule[] = [
  { id: 'r1', name: 'accent-color-token', description: 'Always use `--accent` (#3164f4) or Tailwind `bg-accent` for primary calls-to-action.', enabled: true },
  { id: 'r2', name: 'no-inline-styles', description: 'Avoid raw inline `style={{ ... }}` objects in UI components; prefer CSS tokens.', enabled: true },
  { id: 'r3', name: 'input-validation', description: 'Validate all form inputs at boundary components before dispatching API mutations.', enabled: true },
  { id: 'r4', name: 'stream-cancellation', description: 'Always handle AbortSignal events cleanly in async generator streams.', enabled: true },
];

export const mockRepairRun: RepairRun = {
  id: 'run1',
  repoId: 'r1',
  status: 'awaiting_approval',
  attempts: 1,
  maxAttempts: 3,
  issueDescription: 'TypeError: Cannot read properties of undefined (reading "token") in auth handler during anonymous checkout',
  rootCause: 'Root Cause: `authenticate_user()` returned None for empty sessions, but caller expected a valid `UserSession` instance with a default guest token.',
  replay: false,
  events: [
    {
      id: 'e1',
      type: 'state',
      state: 'Finding the root cause',
      message: 'Architect isolated exception trace in auth/login.py:14',
      attempt: 1,
      agent: 'Architect',
      status: 'pass',
      timestamp: '2026-10-27T10:00:00Z',
    },
    {
      id: 'e2',
      type: 'state',
      state: 'Writing a fix',
      message: 'Debugger generated safe fallback guest token for anonymous requests',
      attempt: 1,
      agent: 'Debug',
      status: 'pass',
      timestamp: '2026-10-27T10:00:05Z',
    },
    {
      id: 'e3',
      type: 'state',
      state: 'Running tests',
      message: 'Running pytest suite: 14 passed, 0 failed',
      attempt: 1,
      agent: 'Test Runner',
      status: 'pass',
      timestamp: '2026-10-27T10:00:10Z',
    },
    {
      id: 'e4',
      type: 'approval',
      state: 'Awaiting approval',
      message: 'Automated patch ready for human reviewer sign-off',
      attempt: 1,
      agent: 'Reviewer',
      status: 'pending',
      timestamp: '2026-10-27T10:00:15Z',
      diff: `--- a/auth/login.py
+++ b/auth/login.py
@@ -12,6 +12,9 @@ class UserSession:
 def authenticate_user(username: str, password_hash: str) -> UserSession:
     """Authenticates credentials against repository store and mints session token."""
     if not username or not password_hash:
-        raise ValueError("Missing username or credentials")
+        # Safe anonymous fallback guest token
+        return UserSession(username="guest", token="guest_anonymous_token")
     
     session_secret = hashlib.sha256(f"{username}:{password_hash}".encode()).hexdigest()`,
      eval: [
        { name: 'Unit test suite: test_auth_anonymous_session (PASSED)', pass: true },
        { name: 'Regression test suite: test_login_flow (PASSED)', pass: true },
        { name: 'Type safety and linting checks (PASSED)', pass: true },
        { name: 'Security audit: no credential leak (PASSED)', pass: true },
      ],
      reviewerOpinion: 'Patch cleanly resolves the unhandled exception while passing all security and regression tests. Advisory: does not override test results.',
    },
  ],
};

export const mockLLMStatus: LLMStatus = {
  activeModel: 'gpt-4o-mini',
  providers: [
    { name: 'OpenAI', status: 'ok', model: 'gpt-4o-mini' },
    { name: 'Anthropic', status: 'cooldown', cooldownUntil: new Date(Date.now() + 45000).toISOString(), model: 'claude-3-5-sonnet' },
    { name: 'Google Gemini', status: 'disabled', model: 'gemini-1.5-pro' },
    { name: 'Groq', status: 'ok', model: 'llama-3.3-70b-versatile' },
    { name: 'Ollama (Local)', status: 'ok', model: 'deepseek-r1:8b' },
  ],
  recentCalls: [
    { id: 'c1', provider: 'OpenAI', model: 'gpt-4o-mini', status: 'ok', latencyMs: 240, timestamp: '14:31:02', cached: false, switched: false },
    { id: 'c2', provider: 'Anthropic', model: 'claude-3-5-sonnet', status: 'cooldown', latencyMs: 12, timestamp: '14:30:45', cached: false, switched: true },
    { id: 'c3', provider: 'OpenAI (Fallback)', model: 'gpt-4o-mini', status: 'ok', latencyMs: 310, timestamp: '14:30:46', cached: true, switched: true },
    { id: 'c4', provider: 'Groq', model: 'llama-3.3-70b-versatile', status: 'ok', latencyMs: 110, timestamp: '14:28:19', cached: false, switched: false },
  ],
};

export const mockIndexStatus = (stage: Repo['status']): IndexStatus => {
  const map: Record<string, { progress: number; filesDone: number; totalFiles: number }> = {
    cloning: { progress: 10, filesDone: 0, totalFiles: 42 },
    parsing: { progress: 30, filesDone: 14, totalFiles: 42 },
    graph: { progress: 55, filesDone: 28, totalFiles: 42 },
    embedding: { progress: 75, filesDone: 36, totalFiles: 42 },
    summaries: { progress: 90, filesDone: 40, totalFiles: 42 },
    ready: { progress: 100, filesDone: 42, totalFiles: 42 },
    error: { progress: 0, filesDone: 0, totalFiles: 42 },
  };
  const val = map[stage] || map.ready;
  return {
    stage,
    progress: val.progress,
    filesDone: val.filesDone,
    totalFiles: val.totalFiles,
    message: stage === 'ready' ? 'Ready for queries & reviews' : `Indexing stage: ${stage} (${val.filesDone}/${val.totalFiles} files)`,
  };
};

