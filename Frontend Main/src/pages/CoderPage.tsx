import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { streamPost, apiFetch, apiPost, ApiError } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ApiErrorView } from '../components/shared/States';
import { ProviderBadge, CachedBadge } from '../components/shared/Badges';
import { CodeViewer } from '../components/shared/CodeViewer';
import RepairCard from '../components/coder/RepairCard';
import ReactMarkdown from 'react-markdown';
import { detectMode, improveQuestion, resolveFiles, type Mode } from '../components/coder/intent';
import type { AskFinal, FileSlice, Repo, RepairRequest, RepairStartResponse, TreeNode, TreeResponse } from '../api/types';
import { Send, Square, Sparkles, FileCode, MessageSquare, Wrench, Lightbulb, RotateCcw } from 'lucide-react';

type Msg =
  // sentAs: what was actually sent, when it differs from what was typed; notes: file names that were corrected.
  | { role: 'user'; content: string; mode: Mode; sentAs?: string; notes?: string[] }
  | { role: 'assistant'; kind: 'answer'; content: string; meta?: AskFinal; error?: unknown }
  | { role: 'assistant'; kind: 'repair'; runId?: string; error?: unknown; activeRunId?: string };

// Marker regex from docs/API.md. Parse it on the full text, not on single tokens.
const CITATION_RE = /\[([^[\]:]+):(\d+)-(\d+)\]/g;
// Models sometimes group references: [a.py:1-2, b.py:5-9] -> [a.py:1-2] [b.py:5-9] (the backend does the same).
const GROUPED_RE = /\[([^[\]:,;]+:\d+-\d+(?:\s*[,;]\s*[^[\]:,;]+:\d+-\d+)+)\]/g;
const splitGroups = (text: string) =>
  text.replace(GROUPED_RE, (_, refs: string) => refs.split(/[,;]/).map((r) => `[${r.trim()}]`).join(' '));
const NOT_FOUND_TEXT = 'No relevant code found for this question';
const MODE_ORDER: Mode[] = ['ask', 'fix', 'improve'];

/** Every file path in the repo tree. */
function filePaths(node: TreeNode): string[] {
  return node.type === 'file' ? [node.path] : node.children.flatMap(filePaths);
}

const SUGGESTED: { text: string; mode: Mode }[] = [
  { text: 'How does user login work?', mode: 'ask' },
  { text: 'What is the main entry point?', mode: 'ask' },
  { text: 'Where are API routes defined?', mode: 'ask' },
  { text: 'Explain the data flow', mode: 'ask' },
];

// Conversations live here, outside the component, so they survive moving to another page and back.
let savedChats: Record<string, Msg[]> = {};

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
const fieldStyle: React.CSSProperties = {
  height: 42,
  padding: '0 16px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.12)',
  background: 'rgba(255,255,255,.07)',
  color: '#DFF5EB',
  fontSize: 14,
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
};

const MODE_INFO: Record<Mode, { label: string; icon: typeof MessageSquare; color: string; hint: string }> = {
  ask: {
    label: 'Ask',
    icon: MessageSquare,
    color: '#D9A066',
    hint: 'Answers with file:line citations you can open.',
  },
  fix: {
    label: 'Fix',
    icon: Wrench,
    color: '#DC1F1F',
    hint: 'Starts a repair run: reproduces the bug, patches it on a separate branch, and waits for your approval.',
  },
  improve: {
    label: 'Improve',
    icon: Lightbulb,
    color: '#8EA2E0',
    hint: 'Gets concrete optimisation suggestions with citations. Automatic code changes are only for bugs a test can show (Fix).',
  },
};

export default function CoderPage() {
  const { selectedRepoId, setSelectedRepoId, setSelectedRepo } = useRepo();
  // One conversation per repo. Each update names its repo, so a reply always lands in the
  // conversation it was asked in.
  const [chats, setChats] = useState<Record<string, Msg[]>>(savedChats);
  const messages = useMemo(() => (selectedRepoId && chats[selectedRepoId]) || [], [chats, selectedRepoId]);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { savedChats = chats; }, [chats]);

  const reposQ = useQuery({
    queryKey: ['repos'],
    queryFn: () => apiFetch<Repo[]>('/api/repos'),
  });

  // Switching repos or leaving the page stops a running answer (and its LLM calls).
  // Repair runs keep going on the server; their cards pick them up again.
  useEffect(() => () => abortRef.current?.abort(), [selectedRepoId]);

  const [input, setInput] = useState('');
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const [testCommand, setTestCommand] = useState('');
  const [busy, setBusy] = useState<Mode | null>(null);
  const [currentAgent, setCurrentAgent] = useState<{ agent: string; status: string } | null>(null);
  const [viewFile, setViewFile] = useState<{ path: string; start: number; end: number } | null>(null);

  const mode: Mode = modeOverride ?? detectMode(input);
  const ModeIcon = MODE_INFO[mode].icon;
  const streaming = busy === 'ask' || busy === 'improve';

  // The repo's file list, to point file names in a message at real files (shared with Explorer's cache).
  const treeQ = useQuery({
    queryKey: ['tree', selectedRepoId],
    queryFn: () => apiFetch<TreeResponse>(`/api/repos/${selectedRepoId}/tree`),
    enabled: !!selectedRepoId,
  });
  const paths = useMemo(() => (treeQ.data ? filePaths(treeQ.data.root) : []), [treeQ.data]);

  const fileQ = useQuery({
    queryKey: ['file', selectedRepoId, viewFile?.path],
    queryFn: () =>
      apiFetch<FileSlice>(`/api/repos/${selectedRepoId}/file?path=${encodeURIComponent(viewFile!.path)}`),
    enabled: !!selectedRepoId && !!viewFile,
  });

  const fileCode = fileQ.data ? fileQ.data.lines.join('\n') : '';

  // Scroll to bottom on new messages or agent changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentAgent]);

  function updateChat(repo: string, change: (m: Msg[]) => Msg[]) {
    setChats((all) => ({ ...all, [repo]: change(all[repo] || []) }));
  }

  function send(text?: string, forced?: Mode) {
    const content = (text ?? input).trim();
    if (!content || busy || !selectedRepoId) return;
    const sendMode = forced ?? (text === undefined ? mode : detectMode(content));
    setInput('');
    setModeOverride(null);
    // "loam.py" -> "library/loans.py": the agents search better with the real path.
    const resolved = resolveFiles(content, paths);
    const sent = sendMode === 'improve' ? improveQuestion(resolved.text) : resolved.text;
    const userMsg: Msg = {
      role: 'user',
      content,
      mode: sendMode,
      sentAs: sendMode === 'improve' ? sent : undefined,
      notes: resolved.notes.length ? resolved.notes : undefined,
    };
    if (sendMode === 'fix') startRepair(selectedRepoId, userMsg, sent);
    else ask(selectedRepoId, userMsg, sent, sendMode);
  }

  async function ask(repo: string, userMsg: Msg, question: string, askMode: Mode) {
    const updateLast = (change: (m: Msg) => Msg) => updateChat(repo, (m) => [...m.slice(0, -1), change(m[m.length - 1])]);
    updateChat(repo, (m) => [...m, userMsg, { role: 'assistant', kind: 'answer', content: '' }]);
    setBusy(askMode);
    setCurrentAgent({ agent: 'architect', status: 'starting' });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (fields: Partial<Extract<Msg, { kind: 'answer' }>>) =>
      updateLast((m) => (m.role === 'assistant' && m.kind === 'answer' ? { ...m, ...fields } : m));

    try {
      await streamPost(
        `/api/repos/${repo}/ask/stream`,
        { question },
        (ev) => {
          if (ev.event === 'agent') {
            setCurrentAgent({ agent: ev.data.agent, status: ev.data.detail || ev.data.status });
          } else if (ev.event === 'token') {
            setCurrentAgent(null);
            updateLast((m) => (m.role === 'assistant' && m.kind === 'answer' ? { ...m, content: m.content + ev.data.text } : m));
          } else if (ev.event === 'final') {
            patch({ meta: ev.data });
          } else if (ev.event === 'error') {
            patch({ error: new Error(ev.data.message) });
          }
        },
        ctrl.signal,
      );
    } catch (e) {
      // 404/409/422 come back as JSON errors before the stream starts; show them in the chat.
      if ((e as Error).name !== 'AbortError') patch({ error: e });
    } finally {
      setBusy(null);
      setCurrentAgent(null);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  async function startRepair(repo: string, userMsg: Msg, issue: string) {
    updateChat(repo, (m) => [...m, userMsg]);
    setBusy('fix');
    const body: RepairRequest = { issue };
    if (testCommand.trim()) body.test_command = testCommand.trim();
    try {
      const res = await apiPost<RepairStartResponse>(`/api/repos/${repo}/repair`, body);
      updateChat(repo, (m) => [...m, { role: 'assistant', kind: 'repair', runId: res.run_id }]);
    } catch (e) {
      // 409 when another run already holds this repo: offer to open that run here.
      const activeRunId = e instanceof ApiError && e.details.repo_id === repo ? (e.details.run_id as string | undefined) : undefined;
      updateChat(repo, (m) => [...m, { role: 'assistant', kind: 'repair', error: e, activeRunId }]);
    } finally {
      setBusy(null);
    }
  }

  function openRun(runId: string) {
    if (!selectedRepoId) return;
    updateChat(selectedRepoId, (m) => [...m, { role: 'assistant', kind: 'repair', runId }]);
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(null);
    setCurrentAgent(null);
  }

  /** asked: the user message this answer replies to, so a dead end can offer the next step. */
  function renderAnswer(msg: Extract<Msg, { kind: 'answer' }>, asked?: Msg) {
    if (msg.error) return <ApiErrorView error={msg.error} />;
    if (msg.meta?.not_found) {
      const askedText = asked?.role === 'user' ? asked.content : '';
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
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <span>{NOT_FOUND_TEXT}</span>
          <span style={{ fontSize: 12, color: 'rgba(143,168,160,.75)' }}>
            The AI models sometimes miss the code when they are busy, so asking again often works. You can
            also name the function or file as it is in the repo (see Explorer), or, if something is broken,
            describe what goes wrong and run it as a fix.
          </span>
          {askedText && asked?.role === 'user' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={() => send(askedText, asked.mode)}
                disabled={!!busy}
                className="px-4 py-1.5 rounded-full border border-border bg-bg-raised text-text text-xs font-semibold cursor-pointer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <RotateCcw size={12} /> Ask again
              </button>
              <button
                type="button"
                onClick={() => send(askedText, 'fix')}
                disabled={!!busy}
                className="px-4 py-1.5 rounded-full border border-accent text-accent text-xs font-semibold cursor-pointer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Wrench size={12} /> Run as Fix
              </button>
            </div>
          )}
        </div>
      );
    }
    if (!msg.content) {
      return (
        <span className="typing-dots" role="status" aria-label="thinking">
          <i /><i /><i />
        </span>
      );
    }

    // Only markers listed in final.citations are verified; others stay plain text.
    const verified = new Set((msg.meta?.citations || []).map((c) => `${c.file}:${c.start_line}-${c.end_line}`));
    const parts = splitGroups(msg.content).split(CITATION_RE);
    const nodes: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i += 4) {
      const text = parts[i];
      if (text) nodes.push(<ReactMarkdown key={'t' + i}>{text}</ReactMarkdown>);
      if (parts[i + 1]) {
        const file = parts[i + 1];
        const start = parseInt(parts[i + 2], 10);
        const end = parseInt(parts[i + 3], 10);
        const key = `${file}:${start}-${end}`;
        if (!verified.has(key)) {
          nodes.push(
            <span key={'c' + i} style={{ margin: '0 4px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(143,168,160,.5)' }}>
              [{key}]
            </span>,
          );
          continue;
        }
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
            title={`Click to inspect ${key}`}
          >
            <FileCode size={11} />
            {key}
          </button>,
        );
      }
    }
    return <div style={{ lineHeight: 1.7, color: '#DFF5EB', fontSize: 14 }}>{nodes}</div>;
  }

  function renderRepair(msg: Extract<Msg, { kind: 'repair' }>) {
    if (msg.runId) return <RepairCard runId={msg.runId} />;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ApiErrorView error={msg.error} />
        {msg.activeRunId && (
          <button
            type="button"
            onClick={() => openRun(msg.activeRunId!)}
            className="self-start px-4 py-1.5 rounded-full border border-border bg-bg-raised text-text text-xs font-medium cursor-pointer"
          >
            Open the active run
          </button>
        )}
      </div>
    );
  }

  const header = (
    <div style={{ marginBottom: 24 }}>
      <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px' }}>
        <span className="page-title-accent">CODER</span>
        <span>ask or fix your codebase</span>
      </h1>
      <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,.12)', margin: '14px 0' }} />
      <p style={{ color: '#8FA8A0', fontSize: 13 }}>
        Ask how the code works, or describe a bug and CodeXray fixes it on a separate branch
      </p>
    </div>
  );

  if (!selectedRepoId) {
    const repos = reposQ.data || [];
    return (
      <div>
        {header}
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
            Choose an indexed codebase from the top bar or pick one below.
          </p>

          {repos.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {repos.map((r) => (
                <button
                  key={r.repo_id}
                  type="button"
                  onClick={() => {
                    setSelectedRepoId(r.repo_id);
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
              ))}
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
      {header}

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20, height: 'calc(100vh - 290px)', minHeight: 420 }}>
        {/* Conversation */}
        <div style={{ ...glassPanel, display: 'flex', flexDirection: 'column' }}>
          {/* Live agent banner while an answer is being prepared */}
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
                className="pulse-dot"
                style={{ width: 8, height: 8, borderRadius: '50%', background: '#D9A066', boxShadow: '0 0 8px #D9A066', display: 'inline-block' }}
              />
              <span>
                <strong>{currentAgent.agent}:</strong> {currentAgent.status}
              </span>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
                <EmptyState
                  title="Ask a question or describe a bug"
                  description="Questions get answers with citations. Bug reports start a repair run you approve."
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {SUGGESTED.map((s) => (
                    <button
                      key={s.text}
                      type="button"
                      onClick={() => send(s.text, s.mode)}
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
                      {s.text}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: 'rgba(143,168,160,.6)', fontFamily: 'Inter, sans-serif' }}>
                  To fix something, describe it: “The total is wrong when the cart is empty”.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'msg-in-user' : 'msg-in-bot'}
                style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}
              >
                <div
                  style={{
                    maxWidth: m.role === 'assistant' && m.kind === 'repair' ? '100%' : '88%',
                    width: m.role === 'assistant' && m.kind === 'repair' ? '100%' : undefined,
                    borderRadius: 14,
                    padding: '12px 16px',
                    fontSize: 14,
                    ...(m.role === 'user'
                      ? { background: '#DC1F1F', color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 500 }
                      : { ...glassStrong, borderRadius: 14 }),
                  }}
                >
                  {m.role === 'user' ? (
                    <>
                      {m.mode !== 'ask' && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 4 }}>
                          {m.mode === 'fix' ? <Wrench size={11} /> : <Lightbulb size={11} />}
                          {m.mode === 'fix' ? 'Fix request' : 'Improve request'}
                        </span>
                      )}
                      {m.content}
                      {(m.notes || m.sentAs) && (
                        <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, fontWeight: 400, opacity: 0.8, lineHeight: 1.45 }}>
                          {m.notes?.map((n) => <span key={n} style={{ display: 'block' }}>({n})</span>)}
                          {m.sentAs && <span style={{ display: 'block' }}>Asked as: “{m.sentAs}”</span>}
                        </span>
                      )}
                    </>
                  ) : m.kind === 'repair' ? (
                    renderRepair(m)
                  ) : (
                    <>
                      {renderAnswer(m, messages[i - 1])}
                      {m.meta && !m.meta.not_found && (
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
                          <CachedBadge cached={!!m.meta.cached} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {busy === 'fix' && (
              <div className="msg-in-bot" style={{ display: 'flex' }}>
                <div style={{ ...glassStrong, borderRadius: 14, padding: '12px 16px', fontSize: 13, color: '#D9A066', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="typing-dots"><i /><i /><i /></span> Starting a repair run…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer: one box for both; it adapts to what you type */}
          <div
            style={{
              ...glassStrong,
              borderRadius: 0,
              borderBottom: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setModeOverride(MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length])}
                title={modeOverride ? 'Switch mode' : 'Detected from your message. Click to switch.'}
                aria-label={`Mode: ${MODE_INFO[mode].label}. Click to switch.`}
                style={{
                  height: 42,
                  padding: '0 12px',
                  borderRadius: 10,
                  border: `1px solid ${MODE_INFO[mode].color}66`,
                  background: `${MODE_INFO[mode].color}1f`,
                  color: MODE_INFO[mode].color,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'Inter, sans-serif',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'all 0.2s ease',
                }}
              >
                <ModeIcon size={14} />
                {MODE_INFO[mode].label}
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send();
                }}
                placeholder="Ask about the code, or describe a bug to fix…"
                disabled={!!busy}
                maxLength={4000}
                style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
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
                  disabled={!!busy || !input.trim()}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 999,
                    background: '#DC1F1F',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    border: 'none',
                    cursor: busy || !input.trim() ? 'default' : 'pointer',
                    opacity: busy || !input.trim() ? 0.55 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {mode === 'fix' ? 'Fix it' : mode === 'improve' ? 'Suggest' : 'Send'}{' '}
                  {mode === 'fix' ? <Wrench size={12} /> : mode === 'improve' ? <Lightbulb size={12} /> : <Send size={12} />}
                </button>
              )}
            </div>

            {/* Fix mode needs one more (optional) detail */}
            {mode === 'fix' && (
              <input
                value={testCommand}
                onChange={(e) => setTestCommand(e.target.value)}
                placeholder="Test command (optional, default: python -m pytest -q)"
                disabled={!!busy}
                style={{ ...fieldStyle, height: 34, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
              />
            )}
            <p style={{ fontSize: 11.5, color: 'rgba(143,168,160,.7)', fontFamily: 'Inter, sans-serif' }}>
              <span style={{ color: MODE_INFO[mode].color, fontWeight: 600 }}>{MODE_INFO[mode].label}:</span> {MODE_INFO[mode].hint}
              {!modeOverride && input.trim() && ' Detected from your message; click the chip to switch.'}
            </p>
          </div>
        </div>

        {/* Code viewer pane */}
        <div style={{ ...glassDense, display: 'flex', flexDirection: 'column', padding: 16, overflowY: 'auto' }}>
          {viewFile ? (
            fileQ.isLoading ? (
              <Loading />
            ) : fileQ.isError ? (
              <ApiErrorView error={fileQ.error} onRetry={() => fileQ.refetch()} />
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
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewFile.path}</span>
                  <span style={{ color: '#D9A066', fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>
                    L{viewFile.start}-{viewFile.end}
                  </span>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <CodeViewer
                    code={fileCode}
                    language="python"
                    highlightLines={Array.from({ length: viewFile.end - viewFile.start + 1 }, (_, i) => viewFile.start + i)}
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
