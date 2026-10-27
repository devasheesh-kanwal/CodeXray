import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { streamPost, apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState } from '../components/shared/States';
import { ProviderBadge, CachedBadge } from '../components/shared/Badges';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactMarkdown from 'react-markdown';
import type { Citation, AskResponse } from '../api/types';

type Msg = { role: 'user' | 'assistant'; content: string; meta?: { citations: Citation[]; confidence: number; provider: string; model: string; cached: boolean; not_found: boolean } };

const CITATION_RE = /\[([^\]]+?):(\d+)-(\d+)\]/g;

export default function AskPage() {
  const { selectedRepoId } = useRepo();
  const [messages, setMessages] = useState<Msg[]>([]);
  const historyRef = useRef<Record<string, Msg[]>>({});
  useEffect(() => {
    if (selectedRepoId) historyRef.current[selectedRepoId] = messages;
  }, [messages, selectedRepoId]);
  const prevRepoRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevRepoRef.current && prevRepoRef.current !== selectedRepoId) {
      // already saved via messages effect
    }
    if (selectedRepoId) {
      setMessages(historyRef.current[selectedRepoId] || []);
    }
    prevRepoRef.current = selectedRepoId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepoId]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [aborter, setAborter] = useState<AbortController | null>(null);
  const [viewFile, setViewFile] = useState<{ path: string; start: number; end: number } | null>(null);
  const fileQ = useQuery({
    queryKey: ['file', selectedRepoId, viewFile?.path],
    queryFn: () => apiFetch<{ path: string; content: string }>(`/api/repos/${selectedRepoId}/file?path=${encodeURIComponent(viewFile!.path)}`),
    enabled: !!selectedRepoId && !!viewFile,
  });

  if (!selectedRepoId) return <EmptyState title="Select a repository" description="Choose a repo in the top bar." />;

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: q };
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '' }]);
    setStreaming(true);
    const ctrl = new AbortController();
    setAborter(ctrl);
    try {
      await streamPost('/api/ask', { repoId: selectedRepoId, question: q }, (ev) => {
        if (ev.type === 'token') {
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + ev.text };
            return copy;
          });
        } else if (ev.type === 'meta') {
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { ...copy[copy.length - 1], meta: { citations: ev.citations, confidence: ev.confidence, provider: ev.provider, model: ev.model, cached: ev.cached, not_found: ev.not_found } };
            return copy;
          });
        }
      }, ctrl.signal);
    } catch (e) {
      // fallback non-streaming
      try {
        const resp = await apiFetch<AskResponse>('/api/ask', { method: 'POST', body: JSON.stringify({ repoId: selectedRepoId, question: q }) });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: resp.answer, meta: { citations: resp.citations, confidence: resp.confidence, provider: resp.provider, model: resp.model, cached: resp.cached, not_found: resp.not_found } };
          return copy;
        });
      } catch (e2) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: 'Error: ' + (e2 as Error).message };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
      setAborter(null);
    }
  }

  function stop() {
    aborter?.abort();
  }

  function renderContent(msg: Msg) {
    if (msg.meta?.not_found) {
      return (
        <div className="bg-surface-muted border border-border rounded-lg p-4 text-body-sm text-text-secondary">
          No relevant code found in this repo.
        </div>
      );
    }
    const parts = msg.content.split(CITATION_RE);
    // split produces [text, file, start, end, text, ...]
    const nodes: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i += 4) {
      const text = parts[i];
      if (text) nodes.push(<ReactMarkdown key={'t' + i}>{text}</ReactMarkdown>);
      if (parts[i + 1]) {
        const file = parts[i + 1];
        const start = parseInt(parts[i + 2], 10);
        const end = parseInt(parts[i + 3], 10);
        nodes.push(
          <button
            key={'c' + i}
            onClick={() => setViewFile({ path: file, start, end })}
            className="inline-block mx-1 px-2 py-0.5 rounded-full text-caption font-medium bg-accent-soft text-accent hover:bg-accent hover:text-white"
          >
            {file}:{start}-{end}
          </button>,
        );
      }
    }
    return <div className="prose prose-sm max-w-none">{nodes}</div>;
  }

  return (
    <div className="grid grid-cols-5 gap-6 h-[calc(100vh-160px)]">
      <div className="col-span-3 flex flex-col bg-surface border border-border rounded-xl">
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 && <EmptyState title="Ask about this repo" description="Type a question below." />}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div className={`inline-block max-w-[90%] ${m.role === 'user' ? 'bg-accent text-white' : 'bg-surface-muted'} rounded-xl px-4 py-3 text-body-sm text-left`}>
                {m.role === 'assistant' ? renderContent(m) : m.content}
                {m.role === 'assistant' && m.meta && !m.meta.not_found && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-caption text-text-muted">confidence {Math.round(m.meta.confidence * 100)}%</span>
                    <ProviderBadge provider={m.meta.provider} model={m.meta.model} />
                    <CachedBadge cached={m.meta.cached} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="Ask a question…"
            className="flex-1 h-10 px-3 rounded-md border border-border bg-surface text-body-sm"
            disabled={streaming}
          />
          {streaming ? (
            <button onClick={stop} className="px-4 py-2 rounded-lg bg-danger text-white text-body-sm">Stop</button>
          ) : (
            <button onClick={send} className="px-4 py-2 rounded-lg bg-accent text-white text-body-sm">Send</button>
          )}
        </div>
      </div>
      <div className="col-span-2 bg-surface border border-border rounded-xl p-4 overflow-auto">
        {viewFile ? (
          fileQ.isLoading ? <Loading /> : fileQ.data ? (
            <CodeViewer code={fileQ.data.content} highlightLines={Array.from({ length: viewFile.end - viewFile.start + 1 }, (_, i) => viewFile.start + i)} />
          ) : null
        ) : (
          <EmptyState title="Code viewer" description="Click a citation chip." />
        )}
      </div>
    </div>
  );
}
