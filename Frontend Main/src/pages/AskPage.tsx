import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { streamPost, apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState } from '../components/shared/States';
import { ProviderBadge, CachedBadge } from '../components/shared/Badges';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactMarkdown from 'react-markdown';
import type { Citation, AskResponse } from '../api/types';
import { Send, Square } from 'lucide-react';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  meta?: {
    citations: Citation[];
    confidence: number;
    provider: string;
    model: string;
    cached: boolean;
    not_found: boolean;
  };
};

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
    if (selectedRepoId) {
      setMessages(historyRef.current[selectedRepoId] || []);
    }
    prevRepoRef.current = selectedRepoId;
  }, [selectedRepoId]);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [aborter, setAborter] = useState<AbortController | null>(null);
  const [viewFile, setViewFile] = useState<{ path: string; start: number; end: number } | null>(null);

  const fileQ = useQuery({
    queryKey: ['file', selectedRepoId, viewFile?.path],
    queryFn: () =>
      apiFetch<{ path: string; content: string }>(
        `/api/repos/${selectedRepoId}/file?path=${encodeURIComponent(viewFile!.path)}`,
      ),
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
      await streamPost(
        '/api/ask',
        { repoId: selectedRepoId, question: q },
        (ev) => {
          if (ev.type === 'token') {
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                content: copy[copy.length - 1].content + ev.text,
              };
              return copy;
            });
          } else if (ev.type === 'meta') {
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                meta: {
                  citations: ev.citations,
                  confidence: ev.confidence,
                  provider: ev.provider,
                  model: ev.model,
                  cached: ev.cached,
                  not_found: ev.not_found,
                },
              };
              return copy;
            });
          }
        },
        ctrl.signal,
      );
    } catch {
      // fallback non-streaming
      try {
        const resp = await apiFetch<AskResponse>('/api/ask', {
          method: 'POST',
          body: JSON.stringify({ repoId: selectedRepoId, question: q }),
        });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: resp.answer,
            meta: {
              citations: resp.citations,
              confidence: resp.confidence,
              provider: resp.provider,
              model: resp.model,
              cached: resp.cached,
              not_found: resp.not_found,
            },
          };
          return copy;
        });
      } catch (e2) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: 'Error: ' + (e2 as Error).message,
          };
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
        <div className="bg-bg-raised border border-border rounded-[10px] p-3.5 text-sm text-text-muted">
          No relevant code found in this repo.
        </div>
      );
    }
    const parts = msg.content.split(CITATION_RE);
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
            type="button"
            onClick={() => setViewFile({ path: file, start, end })}
            className="inline-flex items-center mx-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-accent-soft text-text border border-accent/30 hover:bg-accent hover:text-white transition-colors cursor-pointer"
          >
            {file}:{start}-{end}
          </button>,
        );
      }
    }
    return <div className="space-y-2 leading-relaxed">{nodes}</div>;
  }

  return (
    <div className="grid grid-cols-5 gap-6 h-[calc(100vh-170px)] font-sans">
      {/* Chat pane */}
      <div className="col-span-3 flex flex-col bg-bg-surface border border-border rounded-[14px] overflow-hidden">
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <EmptyState title="Ask about this repo" description="Type a question below to analyze codebase architecture with exact citations." />
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <div
                className={`inline-block max-w-[90%] rounded-[14px] px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'bg-accent text-white font-medium shadow-md'
                    : 'bg-bg-raised text-text border border-border'
                }`}
              >
                {m.role === 'assistant' ? renderContent(m) : m.content}
                {m.role === 'assistant' && m.meta && !m.meta.not_found && (
                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-border/50">
                    <span className="text-xs font-mono text-text-faint">
                      confidence {Math.round(m.meta.confidence * 100)}%
                    </span>
                    <ProviderBadge provider={m.meta.provider} model={m.meta.model} />
                    <CachedBadge cached={m.meta.cached} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Input Bar */}
        <div className="border-t border-border p-3.5 flex gap-2.5 bg-bg-surface">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="Ask a question about the repository…"
            className="flex-1 h-11 px-4 rounded-[10px] border border-border bg-bg-raised text-text placeholder:text-text-faint text-sm font-sans focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="px-5 py-2.5 rounded-full border border-accent text-accent hover:bg-accent-soft text-xs font-semibold tracking-wider uppercase inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Square size={13} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              className="px-6 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white text-xs font-semibold tracking-wider uppercase inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Send</span>
              <Send size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Code viewer pane */}
      <div className="col-span-2 bg-bg-surface border border-border rounded-[14px] p-4 overflow-auto flex flex-col">
        {viewFile ? (
          fileQ.isLoading ? (
            <Loading />
          ) : fileQ.data ? (
            <div className="space-y-2 flex-1 flex flex-col">
              <div className="flex items-center justify-between text-xs font-mono text-text-muted px-1">
                <span className="truncate">{viewFile.path}</span>
                <span className="shrink-0 text-accent font-semibold ml-2">
                  L{viewFile.start}-{viewFile.end}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <CodeViewer
                  code={fileQ.data.content}
                  highlightLines={Array.from(
                    { length: viewFile.end - viewFile.start + 1 },
                    (_, i) => viewFile.start + i,
                  )}
                />
              </div>
            </div>
          ) : null
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState title="Code viewer" description="Click any citation chip to inspect code with highlighted lines." />
          </div>
        )}
      </div>
    </div>
  );
}
