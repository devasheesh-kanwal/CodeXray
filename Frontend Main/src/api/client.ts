import { mockFetch, mockStreamPost, mockSubscribeRepairEvents } from './mock';
import type { AskStreamEvent, ErrorBody, RepairEvent } from './types';

// Production is served by FastAPI on the same origin, so all API calls must
// stay on that host and go to the real backend. Mock mode and an explicit API
// host are local-development options only.
export const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true';
const BASE = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/** An API error in the backend's standard format. status 0 means the backend was unreachable. */
export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details || {};
  }
}

const NETWORK_ERROR: ErrorBody = { code: 'NETWORK_ERROR', message: 'Backend unreachable', details: {} };

/** Turn a non-2xx response into an ApiError, reading the {"error": {...}} body when there is one. */
async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    if (body?.error?.message) return new ApiError(res.status, body.error);
  } catch {
    // not JSON; fall through
  }
  return new ApiError(res.status, { code: 'HTTP_ERROR', message: res.statusText || `HTTP ${res.status}`, details: {} });
}

async function send(path: string, options?: RequestInit): Promise<Response> {
  if (USE_MOCK) return mockFetch(path, options);
  try {
    return await fetch(BASE + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, NETWORK_ERROR);
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await send(path, options);
  if (!res.ok) throw await toApiError(res);
  return res.json() as Promise<T>;
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

/** Parse one SSE block ("event: x\ndata: {...}") into {event, data}. */
function parseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * POST that returns an SSE stream (the Ask stream). EventSource only supports GET,
 * so this uses fetch + ReadableStream and splits the body on blank lines.
 * Non-2xx responses (422/404/409) are normal JSON errors and are thrown as ApiError.
 */
export async function streamPost(
  path: string,
  body: unknown,
  onEvent: (e: AskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (USE_MOCK) return mockStreamPost(path, body, onEvent, signal);
  const res = await send(path, { method: 'POST', body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw await toApiError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const parsed = parseBlock(block);
      if (parsed) onEvent(parsed as AskStreamEvent);
    }
  }
  // A last event without the closing blank line (e.g. a proxy trimmed it) still counts.
  const last = parseBlock(buffer + decoder.decode());
  if (last) onEvent(last as AskStreamEvent);
}

export type RepairStreamHandlers = {
  onOpen?: () => void;
  onEvent: (e: RepairEvent) => void;
  onDone: (state: string) => void;
  onError: (e: ErrorBody) => void;
};

/** Follow GET /api/repairs/{run_id}/events with EventSource. Returns a close function. */
export function subscribeRepairEvents(runId: string, h: RepairStreamHandlers): () => void {
  if (USE_MOCK) return mockSubscribeRepairEvents(runId, h);
  const es = new EventSource(`${BASE}/api/repairs/${runId}/events`);
  es.addEventListener('open', () => h.onOpen?.());
  es.addEventListener('repair_event', (e) => h.onEvent(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('done', (e) => {
    h.onDone(JSON.parse((e as MessageEvent).data).state);
    es.close();
  });
  es.addEventListener('error', (e) => {
    const data = (e as MessageEvent).data;
    // A server-sent `error` event has data; a dropped connection does not (EventSource retries it).
    if (data) {
      h.onError(JSON.parse(data));
      es.close();
    }
  });
  return () => es.close();
}
