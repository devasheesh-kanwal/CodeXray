// In-browser stand-in for the backend when VITE_USE_MOCK=true. Same paths and shapes as Backend/docs/API.md.
import type { AskStreamEvent, RepairRun } from '../types';
import type { RepairStreamHandlers } from '../client';
import {
  delay, mockRepos, mockStatus, mockTree, mockGraph, mockFiles, mockAsk,
  mockReview, mockRules, mockRepairRun, mockRepairEvents, mockLLMStatus, mockModels,
} from './data';

let repairRun: RepairRun = { ...mockRepairRun };
let pickedModel: string | null = null;
let pickedEmbedding: 'gemini' | 'nvidia' = 'nvidia';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function error(status: number, code: string, message: string) {
  return json({ error: { code, message, details: {} } }, status);
}

export async function mockFetch(path: string, options?: RequestInit): Promise<Response> {
  await delay(200);
  const url = new URL(path, 'http://mock');
  const p = url.pathname;
  const method = (options?.method || 'GET').toUpperCase();
  const body = JSON.parse((options?.body as string) || '{}');
  let m: RegExpMatchArray | null;

  if (p === '/api/health') return json({ status: 'ok', version: 'mock', mock_mode: true, demo_mode: false });
  if (p === '/api/llm/status') return json(mockLLMStatus);
  if (p === '/api/llm/models' || (p === '/api/llm/selection' && method === 'PUT')) {
    if (method === 'PUT') {
      if (body.model !== null && !mockModels.models.some((m) => m.id === body.model)) {
        return error(422, 'VALIDATION_ERROR', `Unknown model '${body.model}'`);
      }
      pickedModel = body.model;
    }
    return json({ ...mockModels, mode: pickedModel ? 'manual' : 'auto', selected: pickedModel });
  }
  if (p === '/api/embeddings' || (p === '/api/embeddings/selection' && method === 'PUT')) {
    if (method === 'PUT') pickedEmbedding = body.provider;
    return json({
      enabled: true, selected: pickedEmbedding, adding_vectors: [],
      providers: [
        { id: 'gemini', label: 'Gemini', model: 'gemini-embedding-2', available: true },
        { id: 'nvidia', label: 'NVIDIA', model: 'nvidia/nemotron-3.5-embed-1b', available: true },
      ],
    });
  }
  if (p === '/api/repos' && method === 'GET') return json(mockRepos);
  if (p === '/api/repos' && method === 'POST') return json({ repo_id: 'repo_flask_todo', status: 'queued' }, 202);
  if ((m = p.match(/^\/api\/repos\/[^/]+\/(\w+)$/))) {
    switch (m[1]) {
      case 'status': return json(mockStatus);
      case 'tree': return json(mockTree);
      case 'graph': return json(mockGraph);
      case 'rules': return json(mockRules);
      case 'file': {
        const lines = mockFiles[url.searchParams.get('path') || ''];
        if (!lines) return error(404, 'NOT_FOUND', 'File not found');
        const start = Number(url.searchParams.get('start') || 1);
        const end = Math.min(Number(url.searchParams.get('end') || lines.length), lines.length);
        return json({ path: url.searchParams.get('path'), start, end, lines: lines.slice(start - 1, end) });
      }
      case 'ask': return json(mockAsk(body.question || ''));
      case 'review': await delay(800); return json(mockReview);
      case 'repair':
        repairRun = { ...mockRepairRun };
        return json({ run_id: 'run_mock' }, 202);
    }
  }
  if ((m = p.match(/^\/api\/repairs\/[^/]+(?:\/(approve|reject))?$/))) {
    if (m[1]) {
      const state = m[1] === 'approve' ? 'MERGED' : 'REJECTED';
      repairRun = { ...repairRun, state, events: [...repairRun.events, { ...repairRun.events[0], ts: new Date().toISOString(), state, message: `Run ${state.toLowerCase()}.` }] };
    }
    return json(repairRun);
  }
  return error(404, 'NOT_FOUND', 'Not found');
}

export async function mockStreamPost(
  _path: string, body: unknown, onEvent: (e: AskStreamEvent) => void, signal?: AbortSignal,
): Promise<void> {
  const resp = mockAsk((body as { question?: string })?.question || '');
  const steps: AskStreamEvent[] = [
    { event: 'agent', data: { agent: 'architect', status: 'running', detail: 'searching code' } },
    { event: 'agent', data: { agent: 'architect', status: 'done', detail: null } },
    { event: 'agent', data: { agent: 'explainer', status: 'running', detail: 'writing the answer' } },
    ...resp.answer.split(/(?<=\s)/).map((text): AskStreamEvent => ({ event: 'token', data: { text } })),
    { event: 'final', data: { ...resp } },
    { event: 'done', data: {} },
  ];
  for (const e of steps) {
    if (signal?.aborted) return;
    await delay(e.event === 'token' ? 25 : 300);
    onEvent(e);
  }
}

export function mockSubscribeRepairEvents(_runId: string, h: RepairStreamHandlers): () => void {
  const timers = mockRepairEvents.map((e, i) => setTimeout(() => h.onEvent(e), i * 500));
  timers.push(setTimeout(() => h.onDone('AWAITING_APPROVAL'), mockRepairEvents.length * 500));
  return () => timers.forEach(clearTimeout);
}
