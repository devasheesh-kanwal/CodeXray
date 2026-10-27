import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { streamPost, apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState } from '../components/shared/States';
import { ProviderBadge, CachedBadge } from '../components/shared/Badges';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactMarkdown from 'react-markdown';
import type { Citation, AskResponse, Repo } from '../api/types';
import { Send, Square, Sparkles, FileCode } from 'lucide-react';

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

const SUGGESTED = [
  'How does user login work?',
  'What is the main entry point?',
  'Where are API routes defined?',
  'Explain the data flow',
];

/* Glass styles */
const glassPanel: React.CSSProperties = {
  background: 'rgba(255,255,255,.055)',
  backdropFilter: 'blur(22px) saturate(160%)',
  WebkitBackdropFilter: 'blur(22px) saturate(160%)',
  border: '1px solid rgba(255,255,255,.12)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10), 0 12px 44px rgba(0,0,0,.40)',
  borderRadius: 16,
  overflow: 'hidden' as const,
};
const glassStrong: React.CSSProperties = {
  background: 'rgba(255,255,255,.09)',
  backdropFilter: 'blur(28px) saturate(160%)',
  WebkitBackdropFilter: 'blur(28px) saturate(160%)',
  border: '1px solid rgba(255,255,255,.14)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12), 0 8px 30px rgba(0,0,0,.35)',
};
const glassDense: React.CSSProperties = {
  background: 'rgba(14,14,18,.74)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,.10)',
  borderRadius: 16,
  overflow: 'hidden' as const,
};

export default function AskPage() {
  const { selectedRepoId, setSelectedRepoId, setSelectedRepo } = useRepo();
  const [messages, setMessages] = useState<Msg[]>([]);
  const historyRef = useRef<Record<string, Msg[]>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const reposQ = useQuery({
    queryKey: ['repos'],
    queryFn: () => apiFetch<Repo[]>('/api/repos'),
  });

  // Auto-select repo if not already set
  useEffect(() => {
    if (!selectedRepoId && reposQ.data && reposQ.data.length > 0) {
      const first = reposQ.data[0];
      const id = first.id || (first as any).repo_id;
      setSelectedRepoId(id);
      setSelectedRepo(first);
    }
  }, [selectedRepoId, reposQ.data, setSelectedRepoId, setSelectedRepo]);

  useEffect(() => {
    if (selectedRepoId) historyRef.current[selectedRepoId] = messages;
  }, [messages, selectedRepoId]);

  const prevRepoRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedRepoId) setMessages(historyRef.current[selectedRepoId] || []);
    prevRepoRef.current = selectedRepoId;
  }, [selectedRepoId]);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<{ agent: string; status: string } | null>(null);
  const [aborter, setAborter] = useState<AbortController | null>(null);
  const [viewFile, setViewFile] = useState<{ path: string; start: number; end: number } | null>(null);

  const fileQ = useQuery({
    queryKey: ['file', selectedRepoId, viewFile?.path],
    queryFn: () =>
      apiFetch<{ path: string; content?: string; lines?: string[] }>(
        `/api/repos/${selectedRepoId}/file?path=${encodeURIComponent(viewFile!.path)}`,
      ),
    enabled: !!selectedRepoId && !!viewFile,
  });

  const fileCode = fileQ.data
    ? fileQ.data.content ?? (Array.isArray(fileQ.data.lines) ? fileQ.data.lines.join('\n') : '')
    : '';

  // Scroll to bottom on new messages or agent changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentAgent]);

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question || streaming || !selectedRepoId) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: question };
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '' }]);
    setStreaming(true);
    setCurrentAgent({ agent: 'Architect', status: 'searching code and symbol graph…' });

    const ctrl = new AbortController();
    setAborter(ctrl);

    try {
      await streamPost(
        '/api/ask',
        { repoId: selectedRepoId, question },
        (ev) => {
          if (ev.type === 'agent_status') {
            setCurrentAgent({ agent: ev.agent, status: ev.status });
          } else if (ev.type === 'token') {
            setMessages((m) => {
              const c = [...m];
              const last = c[c.length - 1];
              if (last && last.role === 'assistant') {
                c[c.length - 1] = { ...last, content: last.content + ev.text };
              }
              return c;
            });
          } else if (ev.type === 'meta') {
            setMessages((m) => {
              const c = [...m];
              const last = c[c.length - 1];
              if (last && last.role === 'assistant') {
                c[c.length - 1] = {
                  ...last,
                  meta: {
                    citations: ev.citations,
                    confidence: ev.confidence,
                    provider: ev.provider,
                    model: ev.model,
                    cached: ev.cached,
                    not_found: ev.not_found,
                  },
                };
              }
              return c;
            });
          } else if (ev.type === 'done') {
            setCurrentAgent(null);
          }
        },
        ctrl.signal,
      );
    } catch {
      // Fallback to non-streaming POST
      try {
        const resp = await apiFetch<AskResponse>('/api/ask', {
          method: 'POST',
          body: JSON.stringify({ repoId: selectedRepoId, question }),
        });
        const mappedCitations: Citation[] = (resp.citations || []).map((c: any) => ({
          file: c.file,
          start: c.start ?? c.start_line ?? 1,
          end: c.end ?? c.end_line ?? (c.start ?? c.start_line ?? 1),
          start_line: c.start_line ?? c.start,
          end_line: c.end_line ?? c.end,
          why: c.why,
        }));
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = {
            role: 'assistant',
            content: resp.answer,
            meta: {
              citations: mappedCitations,
              confidence: resp.confidence,
              provider: resp.provider,
              model: resp.model,
              cached: resp.cached,
              not_found: resp.not_found,
            },
          };
          return c;
        });
      } catch (e2) {
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: 'assistant', content: 'Error: ' + (e2 as Error).message };
          return c;
        });
      }
    } finally {
      setStreaming(false);
      setCurrentAgent(null);
      setAborter(null);
    }
  }

  function stop() {
    aborter?.abort();
    setStreaming(false);
    setCurrentAgent(null);
  }

  function renderContent(msg: Msg) {
    if (msg.meta?.not_found) {
      return (
        <div
          style={{
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.10)',
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 13,
            color: '#8FA8A0',
            fontFamily: 'Inter, sans-serif',
          }}
        >
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
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              margin: '0 4px',
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: 600,
              background: 'rgba(217,160,102,.15)',
              color: '#D9A066',
              border: '1px solid rgba(217,160,102,.35)',
              cursor: 'pointer',
              transition: 'background 0.15s, transform 0.1s',
            }}
            title={`Click to inspect ${file}:${start}-${end}`}
          >
            <FileCode size={11} />
            {file}:{start}-{end}
          </button>,
        );
      }
    }
    return <div style={{ lineHeight: 1.7, color: '#DFF5EB', fontSize: 14 }}>{nodes}</div>;
  }

  if (!selectedRepoId) {
    const repos = reposQ.data || [];
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px' }}>
            <span className="page-title-accent">ASK</span>
            <span>your codebase</span>
          </h1>
        </div>
        <div
          style={{
            ...glassPanel,
            padding: 40,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 400,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(220,31,31,.12)',
              border: '1px solid rgba(220,31,31,.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              color: '#DC1F1F',
            }}
          >
            <Sparkles size={26} />
          </div>
          <h2 style={{ fontSize: 20, fontFamily: 'var(--font-heading, Montserrat)', fontWeight: 600, color: '#DFF5EB', marginBottom: 8 }}>
            Select a repository to begin
          </h2>
          <p style={{ color: '#8FA8A0', fontSize: 14, maxWidth: 440, marginBottom: 24, lineHeight: 1.5 }}>
            Choose an indexed codebase from the top bar or pick one below to start architectural Q&amp;A.
          </p>

          {repos.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {repos.map((r) => {
                const rId = r.id || (r as any).repo_id;
                return (
                  <button
                    key={rId}
                    type="button"
                    onClick={() => {
                      setSelectedRepoId(rId);
                      setSelectedRepo(r);
                    }}
                    style={{
                      padding: '10px 20px',
                      borderRadius: 999,
                      background: 'rgba(255,255,255,.07)',
                      border: '1px solid rgba(255,255,255,.14)',
                      color: '#DFF5EB',
                      fontSize: 13,
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'all 0.18s ease',
                    }}
                  >
                    <span>{r.name}</span>
                    <span style={{ fontSize: 11, color: '#8FA8A0' }}>({r.status})</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ color: '#8FA8A0', fontSize: 13 }}>
              No repositories found. <a href="/repos" style={{ color: '#DC1F1F', textDecoration: 'underline' }}>Go to Repos to add one</a>.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Page title */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px' }}>
          <span className="page-title-accent">ASK</span>
          <span>your codebase</span>
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20, height: 'calc(100vh - 200px)' }}>
        {/* Chat pane */}
        <div style={{ ...glassPanel, display: 'flex', flexDirection: 'column' }}>
          {/* Live Agent Banner */}
          {streaming && currentAgent && (
            <div
              style={{
                padding: '8px 16px',
                background: 'rgba(217,160,102,.10)',
                borderBottom: '1px solid rgba(217,160,102,.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
                color: '#D9A066',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#D9A066',
                  boxShadow: '0 0 8px #D9A066',
                  display: 'inline-block',
                }}
              />
              <span>
                <strong>{currentAgent.agent}:</strong> {currentAgent.status}
              </span>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
                <EmptyState title="Ask about this repo" description="Type a question or pick a suggestion below." />
                {/* Suggested questions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {SUGGESTED.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => send(q)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontFamily: 'Inter, sans-serif',
                        background: 'rgba(255,255,255,.06)',
                        border: '1px solid rgba(255,255,255,.12)',
                        color: '#8FA8A0',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '88%',
                    borderRadius: 14,
                    padding: '12px 16px',
                    fontSize: 14,
                    ...(m.role === 'user'
                      ? { background: '#DC1F1F', color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 500 }
                      : { ...glassStrong, borderRadius: 14 }),
                  }}
                >
                  {m.role === 'assistant' ? renderContent(m) : m.content}
                  {m.role === 'assistant' && m.meta && !m.meta.not_found && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginTop: 10,
                        paddingTop: 8,
                        borderTop: '1px solid rgba(255,255,255,.08)',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(143,168,160,.6)' }}>
                        confidence {Math.round(m.meta.confidence * 100)}%
                      </span>
                      <ProviderBadge provider={m.meta.provider} model={m.meta.model} />
                      <CachedBadge cached={m.meta.cached} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div
            style={{
              ...glassStrong,
              borderRadius: 0,
              borderBottom: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              padding: '12px 16px',
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
              placeholder="Ask a question about the repository…"
              disabled={streaming}
              style={{
                flex: 1,
                height: 42,
                padding: '0 16px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,.12)',
                background: 'rgba(255,255,255,.07)',
                color: '#DFF5EB',
                fontSize: 14,
                fontFamily: 'Inter, sans-serif',
                outline: 'none',
              }}
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                style={{
                  padding: '10px 18px',
                  borderRadius: 999,
                  border: '1px solid rgba(220,31,31,.5)',
                  background: 'rgba(220,31,31,.12)',
                  color: '#DC1F1F',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <Square size={12} /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send()}
                style={{
                  padding: '10px 20px',
                  borderRadius: 999,
                  background: '#DC1F1F',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                Send <Send size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Code viewer pane */}
        <div style={{ ...glassDense, display: 'flex', flexDirection: 'column', padding: 16, overflowY: 'auto' }}>
          {viewFile ? (
            fileQ.isLoading ? (
              <Loading />
            ) : fileQ.data ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#8FA8A0',
                    padding: '0 4px',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {viewFile.path}
                  </span>
                  <span style={{ color: '#D9A066', fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>
                    L{viewFile.start}-{viewFile.end}
                  </span>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <CodeViewer
                    code={fileCode}
                    highlightLines={Array.from(
                      { length: viewFile.end - viewFile.start + 1 },
                      (_, i) => viewFile.start + i,
                    )}
                  />
                </div>
              </div>
            ) : null
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState title="Code viewer" description="Click any citation chip to inspect code." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
