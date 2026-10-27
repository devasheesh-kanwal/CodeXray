import { mockFetch, mockStreamPost, mockSubscribeEvents } from './mock';
import type { AskStreamEvent } from './types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (USE_MOCK) {
    const res = await mockFetch(path, options);
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<T>;
  }
  const res = await fetch(BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  return res.json() as Promise<T>;
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
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as AskStreamEvent);
      } catch {
        // ignore
      }
    }
  }
}

export function subscribeEvents(path: string): EventSource | ReturnType<typeof mockSubscribeEvents> {
  if (USE_MOCK) {
    // adapter: return object with onmessage setter support by wrapping
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
  const es = new EventSource(BASE + path);
  // auto-reconnect handled by EventSource
  return es;
}
