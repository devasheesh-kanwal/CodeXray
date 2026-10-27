import type { Repo, RepairRun } from '../types';
import {
  delay, mockRepos, mockTree, mockGraph, mockFileContent, mockAskResponse,
  mockPRReview, mockRules, mockRepairRun, mockLLMStatus, mockIndexStatus,
} from './data';

let repos = [...mockRepos];
let repairRun: RepairRun = { ...mockRepairRun };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function mockFetch(path: string, options?: RequestInit): Promise<Response> {
  await delay(200);
  const u = new URL(path, 'http://mock');
  if (u.searchParams.get('mockError') === '503') {
    return new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const method = (options?.method || 'GET').toUpperCase();

  // repos
  if (path === '/api/repos' && method === 'GET') return json(repos);
  if (path === '/api/repos' && method === 'POST') {
    const body = JSON.parse((options?.body as string) || '{}');
    const repo: Repo = {
      id: 'r' + (repos.length + 1),
      name: body.url ? body.url.split('/').pop()?.replace('.git', '') || 'repo' : body.localPath?.split('/').pop() || 'repo',
      url: body.url,
      localPath: body.localPath,
      status: 'cloning',
      createdAt: new Date().toISOString(),
    };
    repos = [repo, ...repos];
    // simulate indexing progression
    const stages: Repo['status'][] = ['cloning', 'parsing', 'graph', 'embedding', 'summaries', 'ready'];
    let i = 0;
    const tick = () => {
      if (i < stages.length) {
        repo.status = stages[i];
        i++;
        setTimeout(tick, 1200);
      }
    };
    setTimeout(tick, 1200);
    return json(repo, 201);
  }
  const repoStatusMatch = path.match(/^\/api\/repos\/([^/]+)\/status$/);
  if (repoStatusMatch && method === 'GET') {
    const r = repos.find((x) => x.id === repoStatusMatch[1]);
    return json(mockIndexStatus(r?.status || 'ready'));
  }
  const repoMatch = path.match(/^\/api\/repos\/([^/]+)$/);
  if (repoMatch && method === 'DELETE') {
    repos = repos.filter((x) => x.id !== repoMatch[1]);
    return json({ ok: true });
  }

  // tree
  const treeMatch = path.match(/^\/api\/repos\/([^/]+)\/tree/);
  if (treeMatch) return json(mockTree);

  // graph
  const graphMatch = path.match(/^\/api\/repos\/([^/]+)\/graph/);
  if (graphMatch) return json(mockGraph);

  // file
  const fileMatch = path.match(/^\/api\/repos\/([^/]+)\/file/);
  if (fileMatch) {
    const u = new URL(path, 'http://mock');
    const p = u.searchParams.get('path') || '';
    return json({ path: p, content: mockFileContent[p] || '// no content' });
  }

  // ask (non-stream fallback)
  if (path === '/api/ask' && method === 'POST') {
    const body = JSON.parse((options?.body as string) || '{}');
    await delay(300);
    return json(mockAskResponse(body.question || ''));
  }

  // pr review
  if (path === '/api/pr/review' && method === 'POST') {
    await delay(800);
    return json(mockPRReview);
  }
  if (path === '/api/pr/sample' && method === 'GET') {
    return json({ diff: 'diff --git a/a.ts b/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new' });
  }
  if (path === '/api/rules' && method === 'GET') return json(mockRules);

  // repair
  if (path === '/api/repair/start' && method === 'POST') {
    await delay(300);
    repairRun = { ...mockRepairRun, id: 'run' + Date.now() };
    return json({ runId: repairRun.id });
  }
  const repairStatusMatch = path.match(/^\/api\/repair\/([^/]+)$/);
  if (repairStatusMatch && method === 'GET') return json(repairRun);
  const approveMatch = path.match(/^\/api\/repair\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    repairRun = { ...repairRun, status: 'merged', events: [...repairRun.events, { id: 'e5', type: 'state', state: 'Merged', message: 'Merged locally', attempt: repairRun.attempts, agent: 'plain', status: 'merged', timestamp: new Date().toISOString() }] };
    return json(repairRun);
  }
  const rejectMatch = path.match(/^\/api\/repair\/([^/]+)\/reject$/);
  if (rejectMatch && method === 'POST') {
    repairRun = { ...repairRun, status: 'failed' };
    return json(repairRun);
  }

  // llm status
  if (path === '/api/llm/status') return json(mockLLMStatus);

  return json({ error: 'Not found' }, 404);
}

export async function mockStreamPost(path: string, body: unknown, onEvent: (e: any) => void, signal?: AbortSignal) {
  if (path === '/api/ask') {
    const q = (body as any)?.question || '';
    const resp = mockAskResponse(q);
    // stream tokens
    const tokens = resp.answer.split(/(\s+)/);
    for (const t of tokens) {
      if (signal?.aborted) return;
      await delay(30);
      onEvent({ type: 'token', text: t });
    }
    await delay(50);
    onEvent({ type: 'meta', citations: resp.citations, confidence: resp.confidence, provider: resp.provider, model: resp.model, cached: resp.cached, not_found: resp.not_found });
    onEvent({ type: 'done' });
    return;
  }
  // fallback: single done
  await delay(100);
  onEvent({ type: 'done' });
}

type MockListener = (ev: { data: string }) => void;
export function mockSubscribeEvents(path: string, onMessage: MockListener, _onError?: (e: any) => void) {
  let closed = false;
  const timers: any[] = [];
  if (path.startsWith('/api/repair/')) {
    // emit a few events then keep open
    const evs = repairRun.events;
    evs.forEach((e, i) => {
      const t = setTimeout(() => {
        if (!closed) onMessage({ data: JSON.stringify(e) });
      }, i * 500);
      timers.push(t);
    });
  }
  return {
    close() { closed = true; timers.forEach(clearTimeout); },
    addEventListener() {},
    removeEventListener() {},
    onmessage: null,
    onerror: null,
    onopen: null,
  };
}
