import { mockFetch, mockStreamPost, mockSubscribeEvents } from './mock';
import type { AskStreamEvent, Citation } from './types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizePathAndBody(path: string, options?: RequestInit): { path: string; options?: RequestInit } {
  if (USE_MOCK) return { path, options };

  let reqPath = path;
  let newOptions = options;

  // Map /api/ask to /api/repos/{repoId}/ask
  if (reqPath === '/api/ask' && options?.body) {
    try {
      const parsed = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body as any);
      if (parsed.repoId) {
        reqPath = `/api/repos/${encodeURIComponent(parsed.repoId)}/ask`;
        newOptions = {
          ...options,
          body: JSON.stringify({ question: parsed.question }),
        };
      }
    } catch {}
  }

  // Map /api/pr/review to /api/repos/{repoId}/review
  if (reqPath === '/api/pr/review' && options?.body) {
    try {
      const parsed = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body as any);
      if (parsed.repoId) {
        reqPath = `/api/repos/${encodeURIComponent(parsed.repoId)}/review`;
        newOptions = {
          ...options,
          body: JSON.stringify({
            diff_text: parsed.diff ?? parsed.diff_text,
            base_branch: parsed.base,
            head_branch: parsed.head,
          }),
        };
      }
    } catch {}
  }

  // Map /api/repair/... to backend routes
  if (reqPath === '/api/repair/start' && options?.body) {
    try {
      const parsed = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body as any);
      if (parsed.repoId) {
        reqPath = `/api/repos/${encodeURIComponent(parsed.repoId)}/repair`;
        newOptions = {
          ...options,
          body: JSON.stringify({
            issue: parsed.issue || parsed.issueDescription || 'Fix automated issue',
            test_command: parsed.test_command,
          }),
        };
      }
    } catch {}
  }

  const repairSub = reqPath.match(/^\/api\/repair\/([^/]+)(\/.*)?$/);
  if (repairSub && repairSub[1] !== 'start') {
    reqPath = `/api/repairs/${repairSub[1]}${repairSub[2] || ''}`;
  }

  return { path: reqPath, options: newOptions };
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (USE_MOCK) {
    const res = await mockFetch(path, options);
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  const normalized = normalizePathAndBody(path, options);

  const res = await fetch(BASE + normalized.path, {
    ...normalized.options,
    headers: { 'Content-Type': 'application/json', ...(normalized.options?.headers || {}) },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }

  const json = await res.json();

  // Normalize repos list
  if (normalized.path === '/api/repos' && Array.isArray(json)) {
    return json.map((r: any) => ({
      ...r,
      id: r.id || r.repo_id,
      repo_id: r.repo_id || r.id,
      filesDone: r.filesDone ?? r.files_done,
      totalFiles: r.totalFiles ?? r.files_total,
    })) as T;
  }

  // Normalize single repo response
  if (json && typeof json === 'object' && ('repo_id' in json || 'run_id' in json)) {
    if ('repo_id' in json && !('id' in json)) {
      json.id = json.repo_id;
    }
    if ('run_id' in json && !('runId' in json)) {
      json.runId = json.run_id;
    }
  }

  // Normalize file slice response: { lines: string[] } -> { content: string }
  if (json && typeof json === 'object' && Array.isArray(json.lines) && !json.content) {
    json.content = json.lines.join('\n');
  }

  return json as T;
}

export async function streamPost(
  path: string,
  body: unknown,
  onEvent: (e: AskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (USE_MOCK) {
    await mockStreamPost(path, body, onEvent, signal);
    return;
  }

  let reqPath = path;
  let reqBody = body;

  const parsedBody = body as any;
  if ((path === '/api/ask' || path.endsWith('/ask')) && parsedBody?.repoId) {
    reqPath = `/api/repos/${encodeURIComponent(parsedBody.repoId)}/ask/stream`;
    reqBody = { question: parsedBody.question };
  }

  const res = await fetch(BASE + reqPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let currentData = '';

  const dispatchEvent = () => {
    if (!currentData) return;
    try {
      const data = JSON.parse(currentData);

      if (currentEvent === 'agent' || data.type === 'agent_status') {
        const agent = data.agent || 'Agent';
        const status = data.status || data.detail || (data.action ? `${data.action}…` : 'processing…');
        onEvent({
          type: 'agent_status',
          agent: agent.charAt(0).toUpperCase() + agent.slice(1),
          status,
        });
      } else if (currentEvent === 'token' || data.type === 'token') {
        onEvent({ type: 'token', text: data.text ?? '' });
      } else if (currentEvent === 'final' || data.type === 'meta') {
        const citations: Citation[] = (data.citations || []).map((c: any) => ({
          file: c.file,
          start: c.start ?? c.start_line ?? 1,
          end: c.end ?? c.end_line ?? (c.start ?? c.start_line ?? 1),
          start_line: c.start_line ?? c.start,
          end_line: c.end_line ?? c.end,
          why: c.why,
        }));
        onEvent({
          type: 'meta',
          citations,
          confidence: data.confidence ?? 1.0,
          provider: data.provider ?? 'codexray',
          model: data.model ?? 'system',
          cached: !!data.cached,
          not_found: !!data.not_found,
          steps: data.agent_trace || data.steps,
        });
      } else if (currentEvent === 'done' || data.type === 'done') {
        onEvent({ type: 'done' });
      } else if (currentEvent === 'error' || data.type === 'error') {
        onEvent({ type: 'error', message: data.message || 'Stream error occurred' });
      }
    } catch {
      // ignore JSON parse error on incomplete chunks
    }
    currentEvent = 'message';
    currentData = '';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      dispatchEvent();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        // Empty line indicates event boundary in SSE specification
        dispatchEvent();
        continue;
      }
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const chunk = line.slice(5).trim();
        currentData = currentData ? currentData + '\n' + chunk : chunk;
      }
    }
  }
}

export function subscribeEvents(path: string): EventSource | ReturnType<typeof mockSubscribeEvents> {
  if (USE_MOCK) {
    const handlers: { message?: (e: any) => void; error?: (e: any) => void } = {};
    const mock = mockSubscribeEvents(path, (e) => handlers.message?.(e), (e) => handlers.error?.(e));
    const obj: any = {
      close: () => mock.close(),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(obj, 'onmessage', {
      set(fn) { handlers.message = fn; },
      get() { return handlers.message; },
    });
    Object.defineProperty(obj, 'onerror', {
      set(fn) { handlers.error = fn; },
      get() { return handlers.error; },
    });
    return obj;
  }

  let finalPath = path;
  const repairSub = path.match(/^\/api\/repair\/([^/]+)(\/.*)?$/);
  if (repairSub && repairSub[1] !== 'start') {
    finalPath = `/api/repairs/${repairSub[1]}${repairSub[2] || ''}`;
  }

  const es = new EventSource(BASE + finalPath);
  return es;
}

