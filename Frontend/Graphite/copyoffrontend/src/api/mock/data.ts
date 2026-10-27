import type { Repo, IndexStatus, FileNode, GraphData, AskResponse, PRReview, Rule, RepairRun, LLMStatus } from '../types';

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockRepos: Repo[] = [
  { id: 'r1', name: 'codesense-backend', url: 'https://github.com/example/codesense-backend.git', status: 'ready', createdAt: '2026-10-20T10:00:00Z' },
  { id: 'r2', name: 'my-frontend', localPath: '/Users/dev/my-frontend', status: 'embedding', createdAt: '2026-10-21T12:00:00Z' },
];

export const mockTree: FileNode = {
  path: '', name: 'root', type: 'dir', children: [
    { path: 'src', name: 'src', type: 'dir', children: [
      { path: 'src/api', name: 'api', type: 'dir', children: [
        { path: 'src/api/client.ts', name: 'client.ts', type: 'file' },
        { path: 'src/api/types.ts', name: 'types.ts', type: 'file' },
      ]},
      { path: 'src/index.ts', name: 'index.ts', type: 'file' },
    ]},
    { path: 'package.json', name: 'package.json', type: 'file' },
    { path: 'README.md', name: 'README.md', type: 'file' },
  ],
};

export const mockGraph: GraphData = {
  nodes: [
    { id: 'src/index.ts', label: 'index.ts' },
    { id: 'src/api/client.ts', label: 'client.ts' },
    { id: 'src/api/types.ts', label: 'types.ts' },
    { id: 'src/components/App.tsx', label: 'App.tsx' },
    { id: 'src/utils/format.ts', label: 'format.ts' },
  ],
  edges: [
    { source: 'src/index.ts', target: 'src/components/App.tsx', kind: 'import' },
    { source: 'src/components/App.tsx', target: 'src/api/client.ts', kind: 'import' },
    { source: 'src/api/client.ts', target: 'src/api/types.ts', kind: 'import' },
    { source: 'src/components/App.tsx', target: 'src/utils/format.ts', kind: 'call' },
  ],
};

export const mockFileContent: Record<string, string> = {
  'src/index.ts': "import App from './components/App';\n\nexport function main() {\n  console.log('hello');\n  return App;\n}\n",
  'src/api/client.ts': "export async function get(path: string) {\n  return fetch(path);\n}\n",
  'src/api/types.ts': "export type Foo = { bar: string };\n",
};

export const mockAskResponse = (q: string): AskResponse => ({
  answer: q.includes('auth') ? 'No relevant code found in this repo.' : 'The entry point is `src/index.ts` which renders `App`.\n\nSee [src/index.ts:1-6].',
  citations: q.includes('auth') ? [] : [{ file: 'src/index.ts', start: 1, end: 6 }],
  confidence: q.includes('auth') ? 0 : 0.82,
  provider: 'openai',
  model: 'gpt-4o-mini',
  cached: false,
  not_found: q.includes('auth'),
});

export const mockPRReview: PRReview = {
  summary: '2 findings: 1 design, 1 security.',
  findings: [
    { id: 'f1', severity: 'high', title: 'Breaks project design', description: 'Button color deviates from accent token.', file: 'src/Button.tsx', line: 12, source: 'design', suggested_fix: 'Use accent color #3164f4.', breaks_design: true },
    { id: 'f2', severity: 'medium', title: 'Missing input validation', description: 'No validation on email field.', file: 'src/Form.tsx', line: 8, source: 'security', suggested_fix: 'Add email regex validation.' },
  ],
};

export const mockRules: Rule[] = [
  { id: 'r1', name: 'accent-color', description: 'Use accent token for primary actions.', enabled: true },
  { id: 'r2', name: 'no-inline-styles', description: 'Avoid inline styles.', enabled: true },
];

export const mockRepairRun: RepairRun = {
  id: 'run1',
  repoId: 'r1',
  status: 'awaiting_approval',
  attempts: 1,
  maxAttempts: 3,
  replay: false,
  events: [
    { id: 'e1', type: 'state', state: 'Branch created', message: 'Created branch repair/run1', attempt: 1, agent: 'plain', status: 'pass', timestamp: '2026-10-22T10:00:00Z' },
    { id: 'e2', type: 'state', state: 'Architect analyzing', message: 'Architect proposed a fix', attempt: 1, agent: 'Architect', status: 'pass', timestamp: '2026-10-22T10:00:05Z' },
    { id: 'e3', type: 'state', state: 'Tests running', message: 'Running test suite', attempt: 1, agent: 'plain', status: 'pass', timestamp: '2026-10-22T10:00:10Z' },
    { id: 'e4', type: 'approval', state: 'Awaiting approval', message: 'Review the proposed change', attempt: 1, agent: 'Reviewer', status: 'pending', timestamp: '2026-10-22T10:00:15Z', diff: '@@ -1,3 +1,3 @@\n-old\n+new', eval: [{ name: 'tests', pass: true }, { name: 'lint', pass: true }], reviewerOpinion: 'Looks good; does not override tests.' },
  ],
};

export const mockLLMStatus: LLMStatus = {
  activeModel: 'gpt-4o-mini',
  providers: [
    { name: 'openai', status: 'ok', model: 'gpt-4o-mini' },
    { name: 'anthropic', status: 'cooldown', cooldownUntil: new Date(Date.now() + 60000).toISOString(), model: 'claude-3-5-sonnet' },
    { name: 'google', status: 'disabled', model: 'gemini-1.5-pro' },
  ],
  recentCalls: [
    { id: 'c1', provider: 'openai', model: 'gpt-4o-mini', status: 'ok', latencyMs: 320, timestamp: '2026-10-22T10:00:00Z', cached: false },
    { id: 'c2', provider: 'anthropic', model: 'claude-3-5-sonnet', status: 'cooldown', latencyMs: 0, timestamp: '2026-10-22T09:59:00Z', cached: true },
  ],
};

export const mockIndexStatus = (stage: Repo['status']): IndexStatus => ({ stage, progress: stage === 'ready' ? 100 : 40, message: stage });
