import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { streamPost, apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState } from '../components/shared/States';
import { ConfidenceBadge, AnsweredByBadge, CachedBadge } from '../components/shared/Badges';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation, AskResponse, AgentStep } from '../api/types';
import {
  Send,
  StopCircle,
  FileCode,
  Sparkles,
  Bot,
  User,
  ChevronDown,
  ChevronUp,
  SearchX,
  Cpu,
} from 'lucide-react';


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
    steps?: AgentStep[];
  };
};

const SUGGESTED_QUESTIONS = [
  'How does user login work?',
  'Where is API client configured?',
  'What are the main entry points?',
  'Explain session and cookie handling',
];

const CITATION_RE = /\[([^\]]+?):(\d+)-(\d+)\]/g;

export default function AskPage() {
  const { selectedRepoId, selectedRepo } = useRepo();
  const [searchParams] = useSearchParams();
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
  const [agentStatus, setAgentStatus] = useState<{ agent: string; status: string } | null>(null);
  const [aborter, setAborter] = useState<AbortController | null>(null);
  const [viewFile, setViewFile] = useState<{ path: string; start: number; end: number } | null>({
    path: 'auth/login.py',
    start: 12,
    end: 30,
  });
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  // Prefill if query param exists
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setInput(q);
    }
  }, [searchParams]);

  const fileQ = useQuery({
    queryKey: ['file', selectedRepoId, viewFile?.path],
    queryFn: () =>
      apiFetch<{ path: string; content: string }>(
        `/api/repos/${selectedRepoId}/file?path=${encodeURIComponent(viewFile!.path)}`,
      ),
    enabled: !!selectedRepoId && !!viewFile,
  });

  if (!selectedRepoId) {
    return (
      <EmptyState
        title="No repository selected"
        description="Please select a repository in the top bar to ask architectural or code questions."
      />
    );
  }

  async function sendQuestion(textToSend?: string) {
    const q = (textToSend || input).trim();
    if (!q || streaming) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: q };
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '' }]);
    setStreaming(true);
    setAgentStatus({ agent: 'Architect', status: 'initializing code analysis…' });

    const ctrl = new AbortController();
    setAborter(ctrl);

    try {
      await streamPost(
        '/api/ask',
        { repoId: selectedRepoId, question: q },
        (ev) => {
          if (ev.type === 'agent_status') {
            setAgentStatus({ agent: ev.agent, status: ev.status });
          } else if (ev.type === 'token') {
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
                  steps: ev.steps,
                },
              };
              return copy;
            });
            // If citations exist, open the first one in the code viewer!
            if (ev.citations && ev.citations.length > 0) {
              setViewFile({
                path: ev.citations[0].file,
                start: ev.citations[0].start,
                end: ev.citations[0].end,
              });
            }
          }
        },
        ctrl.signal,
      );
    } catch {
      // Fallback non-streaming
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
              steps: resp.steps,
            },
          };
          return copy;
        });
        if (resp.citations && resp.citations.length > 0) {
          setViewFile({
            path: resp.citations[0].file,
            start: resp.citations[0].start,
            end: resp.citations[0].end,
          });
        }
      } catch (e2) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: 'Error communicating with reasoning engine: ' + (e2 as Error).message,
          };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
      setAgentStatus(null);
      setAborter(null);
    }
  }

  function stop() {
    aborter?.abort();
    setStreaming(false);
    setAgentStatus(null);
  }

  function toggleSteps(idx: number) {
    setExpandedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  function renderContent(msg: Msg, msgIndex: number) {
    if (msg.meta?.not_found) {
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 my-2">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 flex-shrink-0">
              <SearchX size={20} />
            </div>
            <div>
              <h4 className="text-body-sm font-bold text-amber-900 mb-1">No relevant code found in this repo</h4>
              <p className="text-body-sm text-amber-800">
                The indexing agents scanned symbols, functions, and AST references for this repository but found no
                matching implementations or definitions.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => sendQuestion('How does user login work?')}
                  className="text-caption font-semibold px-2.5 py-1 rounded-md bg-amber-200/70 text-amber-900 hover:bg-amber-200"
                >
                  Try: How does user login work?
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const parts = msg.content.split(CITATION_RE);
    const nodes: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i += 4) {
      const text = parts[i];
      if (text) {
        nodes.push(
          <div key={'t' + i} className="prose prose-sm max-w-none text-text-primary leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>,
        );
      }



      if (parts[i + 1]) {
        const file = parts[i + 1];
        const start = parseInt(parts[i + 2], 10);
        const end = parseInt(parts[i + 3], 10);
        const isCurrentActive = viewFile?.path === file && viewFile?.start === start;

        nodes.push(
          <button
            key={'c' + i}
            onClick={() => setViewFile({ path: file, start, end })}
            className={`inline-flex items-center gap-1.5 mx-1 px-2.5 py-0.5 rounded-full text-caption font-mono font-medium transition-all shadow-2xs ${
              isCurrentActive
                ? 'bg-accent text-white ring-2 ring-accent/30 scale-105'
                : 'bg-accent-soft text-accent hover:bg-accent hover:text-white border border-accent/20'
            }`}
            title={`Click to inspect lines ${start}-${end} in ${file}`}
          >
            <FileCode size={12} />
            <span>
              {file}:{start}-{end}
            </span>
          </button>,
        );
      }
    }

    return (
      <div>
        <div className="space-y-3">{nodes}</div>

        {/* Collapsible How the Agents Worked */}
        {msg.meta?.steps && msg.meta.steps.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/70">
            <button
              onClick={() => toggleSteps(msgIndex)}
              className="flex items-center gap-1.5 text-caption font-semibold text-text-secondary hover:text-accent transition-colors"
            >
              <Cpu size={13} className="text-accent" />
              <span>How the agents worked ({msg.meta.steps.length} steps)</span>
              {expandedSteps[msgIndex] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {expandedSteps[msgIndex] && (
              <div className="mt-2 pl-3 border-l-2 border-accent/30 space-y-2 py-1">
                {msg.meta.steps.map((st, sIdx) => (
                  <div key={sIdx} className="text-caption text-text-secondary">
                    <span className="font-semibold text-text-primary mr-1.5">[{st.agent}]:</span>
                    <span>{st.action}</span>
                    {st.durationMs && <span className="text-text-muted ml-1.5 font-mono">({st.durationMs}ms)</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const highlightLines = viewFile
    ? Array.from({ length: viewFile.end - viewFile.start + 1 }, (_, i) => viewFile.start + i)
    : [];

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Repository Q&A</h1>
          <p className="text-body-sm text-text-secondary">
            Multi-agent architectural query engine for <span className="font-semibold text-text-primary">{selectedRepo?.name}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 items-stretch">
        {/* Left Column: Chat Conversation */}
        <div className="col-span-7 flex flex-col bg-surface border border-border rounded-2xl shadow-xs overflow-hidden">
          {/* Live Agent Status Bar */}
          {agentStatus && (
            <div className="bg-accent-soft/80 border-b border-accent/20 px-4 py-2.5 flex items-center justify-between text-body-sm animate-pulse">
              <div className="flex items-center gap-2 text-accent font-medium">
                <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                <span className="font-semibold">{agentStatus.agent}:</span>
                <span>{agentStatus.status}</span>
              </div>
              <span className="text-caption text-accent/70 font-mono">Processing...</span>
            </div>
          )}

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {messages.length === 0 && (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <Sparkles size={24} />
                </div>
                <h3 className="text-lg font-bold text-text-primary mb-1">Ask CodeXray about this repository</h3>
                <p className="text-body-sm text-text-secondary max-w-md mx-auto mb-6">
                  Queries are routed to architecture, review, or lexical indexing agents with full source citations.
                </p>

                <div className="text-caption font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Suggested Questions
                </div>
                <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
                  {SUGGESTED_QUESTIONS.map((sq) => (
                    <button
                      key={sq}
                      onClick={() => sendQuestion(sq)}
                      className="px-3 py-1.5 rounded-full text-caption font-medium bg-surface-muted hover:bg-accent-soft hover:text-accent border border-border text-text-secondary transition-all"
                    >
                      {sq}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center flex-shrink-0 mt-1 shadow-xs">
                    <Bot size={16} />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-3.5 text-body-sm shadow-xs ${
                    m.role === 'user'
                      ? 'bg-accent text-white font-medium rounded-tr-xs'
                      : 'bg-surface-muted/60 border border-border text-text-primary rounded-tl-xs'
                  }`}
                >
                  {m.role === 'assistant' ? (
                    <div>
                      {renderContent(m, i)}

                      {/* Meta Badges */}
                      {m.meta && !m.meta.not_found && (
                        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-border/60">
                          <ConfidenceBadge confidence={m.meta.confidence} />
                          <AnsweredByBadge model={m.meta.model} provider={m.meta.provider} />
                          <CachedBadge cached={m.meta.cached} />
                        </div>
                      )}
                    </div>
                  ) : (
                    m.content
                  )}
                </div>

                {m.role === 'user' && (
                  <div className="w-8 h-8 rounded-lg bg-surface-muted border border-border text-text-secondary flex items-center justify-center flex-shrink-0 mt-1">
                    <User size={16} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Quick Suggestions Pills (when chat is active) */}
          {messages.length > 0 && !streaming && (
            <div className="px-4 py-2 border-t border-border/50 bg-surface flex items-center gap-2 overflow-x-auto">
              <span className="text-[11px] text-text-muted font-medium whitespace-nowrap">Suggested:</span>
              {SUGGESTED_QUESTIONS.slice(0, 3).map((sq) => (
                <button
                  key={sq}
                  onClick={() => sendQuestion(sq)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface-muted hover:bg-accent-soft hover:text-accent border border-border whitespace-nowrap transition-colors"
                >
                  {sq}
                </button>
              ))}
            </div>
          )}

          {/* Chat Input Bar */}
          <div className="p-3 border-t border-border bg-surface flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendQuestion();
              }}
              placeholder="Ask an architecture or codebase question…"
              className="flex-1 h-11 px-4 rounded-xl border border-border bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              disabled={streaming}
            />
            {streaming ? (
              <button
                onClick={stop}
                className="px-5 py-2.5 rounded-xl bg-danger text-white text-body-sm font-semibold flex items-center gap-2 hover:opacity-90"
              >
                <StopCircle size={16} /> Stop
              </button>
            ) : (
              <button
                onClick={() => sendQuestion()}
                disabled={!input.trim()}
                className="px-5 py-2.5 rounded-xl bg-accent text-white text-body-sm font-semibold flex items-center gap-2 hover:bg-accent-hover disabled:opacity-50 transition-all shadow-xs"
              >
                <Send size={15} /> Send
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Code Viewer with Line Highlights */}
        <div className="col-span-5 bg-surface border border-border rounded-2xl flex flex-col shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-surface-muted/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode size={16} className="text-accent" />
              <span className="text-body-sm font-mono font-semibold text-text-primary">
                {viewFile ? viewFile.path : 'Citation Code Viewer'}
              </span>
            </div>
            {viewFile && (
              <span className="px-2.5 py-0.5 rounded-full text-caption font-mono font-semibold bg-accent-soft text-accent border border-accent/20">
                L{viewFile.start}-{viewFile.end}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {viewFile ? (
              fileQ.isLoading ? (
                <div className="p-8">
                  <Loading label="Retrieving cited source code…" />
                </div>
              ) : fileQ.data ? (
                <CodeViewer
                  code={fileQ.data.content}
                  highlightLines={highlightLines}
                  startLine={1}
                  language={viewFile.path.endsWith('.py') ? 'python' : 'typescript'}
                />
              ) : (
                <div className="p-4 text-body-sm text-text-muted">Could not load file.</div>
              )
            ) : (
              <EmptyState
                title="Citation Inspector"
                description="Click any citation chip in an answer (e.g. auth/login.py:12-30) to examine the exact source lines."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

