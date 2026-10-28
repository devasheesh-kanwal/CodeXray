import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { streamPost, apiFetch, apiPost, ApiError } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, ApiErrorView } from '../components/shared/States';
import { ProviderBadge, CachedBadge } from '../components/shared/Badges';
import { CodeViewer } from '../components/shared/CodeViewer';
import RepairCard from '../components/coder/RepairCard';
import ReactMarkdown from 'react-markdown';
import { detectMode, improveQuestion, resolveFiles, type Mode } from '../components/coder/intent';
import type { AskFinal, FileSlice, Repo, RepairRequest, RepairStartResponse, TreeNode, TreeResponse } from '../api/types';
import { Square, Sparkles, FileCode, MessageSquare, Wrench, Lightbulb, RotateCcw, Folder, ChevronDown, Check, Plus, ArrowRight, X } from 'lucide-react';

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
  const [menu, setMenu] = useState<'repo' | 'mode' | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Escape closes an open menu.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  // The message box grows with its text, up to a limit, like a chat composer.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

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

  const repos = reposQ.data || [];
  const currentRepo = repos.find((r) => r.repo_id === selectedRepoId);
  const empty = !selectedRepoId || messages.length === 0;
  const canSend = !!selectedRepoId && !busy && !!input.trim();

  // Folder chip above the composer: the repo this conversation is about.
  const repoChip = (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="coder-chip"
        aria-haspopup="listbox"
        aria-expanded={menu === 'repo'}
        onClick={() => setMenu(menu === 'repo' ? null : 'repo')}
        style={{ background: 'transparent' }}
      >
        <Folder size={15} strokeWidth={1.75} />
        <span>{currentRepo?.name ?? 'Choose a repository'}</span>
        <ChevronDown size={14} className="coder-caret" />
      </button>
      {menu === 'repo' && (
        <div className="coder-menu" role="listbox" style={{ top: 'calc(100% + 6px)', left: 0 }}>
          {repos.length === 0 && (
            <p className="coder-menu-empty">
              No repositories yet. <a href="/repos">Add one on the Repos page</a>.
            </p>
          )}
          {repos.map((r) => (
            <button
              key={r.repo_id}
              type="button"
              role="option"
              aria-selected={r.repo_id === selectedRepoId}
              className="coder-menu-item"
              style={{ background: 'transparent' }}
              onClick={() => {
                setSelectedRepoId(r.repo_id);
                setSelectedRepo(r);
                setMenu(null);
              }}
            >
              <Folder size={14} strokeWidth={1.75} />
              <span style={{ flex: 1 }}>{r.name}</span>
              <span className="coder-menu-meta">{r.files_total} files</span>
              {r.repo_id === selectedRepoId && <Check size={14} style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // The composer: one box for questions, fixes and improvements; it adapts to what you type.
  const composer = (
    <div className="coder-composer-wrap">
      <div className="coder-composer">
        {showOptions && (
          <div className="coder-options">
            <span>Test command for fixes</span>
            <input
              value={testCommand}
              onChange={(e) => setTestCommand(e.target.value)}
              placeholder="python -m pytest -q (default)"
              disabled={!!busy}
              spellCheck={false}
            />
          </div>
        )}
        <textarea
          ref={textRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={selectedRepoId ? 'Ask anything, or describe a bug to fix…' : 'Choose a repository above to start'}
          disabled={!selectedRepoId || !!busy}
          maxLength={4000}
          aria-label="Message"
        />
        <div className="coder-bar">
          <button
            type="button"
            className="coder-icon-btn"
            title="Options"
            aria-label="Options"
            aria-pressed={showOptions}
            onClick={() => setShowOptions((v) => !v)}
            style={{ background: 'transparent' }}
          >
            <Plus size={18} strokeWidth={1.75} />
          </button>

          {/* Mode picker, where the reference has its model picker */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="coder-picker"
              aria-haspopup="listbox"
              aria-expanded={menu === 'mode'}
              onClick={() => setMenu(menu === 'mode' ? null : 'mode')}
              style={{ background: 'transparent' }}
            >
              <ModeIcon size={14} style={{ color: MODE_INFO[mode].color }} />
              <span>{MODE_INFO[mode].label}</span>
              <span className="coder-picker-sub">{modeOverride ? 'manual' : 'auto'}</span>
              <ChevronDown size={14} className="coder-caret" />
            </button>
            {menu === 'mode' && (
              <div className="coder-menu" role="listbox" style={{ bottom: 'calc(100% + 8px)', left: 0, width: 330 }}>
                <button
                  type="button"
                  role="option"
                  aria-selected={!modeOverride}
                  className="coder-menu-item"
                  style={{ background: 'transparent' }}
                  onClick={() => { setModeOverride(null); setMenu(null); }}
                >
                  <Sparkles size={14} />
                  <span style={{ flex: 1 }}>
                    Auto <span className="coder-menu-meta">picks from what you type</span>
                  </span>
                  {!modeOverride && <Check size={14} style={{ color: 'var(--accent)' }} />}
                </button>
                {MODE_ORDER.map((m) => {
                  const Icon = MODE_INFO[m].icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={modeOverride === m}
                      className="coder-menu-item"
                      style={{ background: 'transparent', alignItems: 'flex-start' }}
                      onClick={() => { setModeOverride(m); setMenu(null); }}
                    >
                      <Icon size={14} style={{ color: MODE_INFO[m].color, marginTop: 2 }} />
                      <span style={{ flex: 1 }}>
                        {MODE_INFO[m].label}
                        <span className="coder-menu-hint">{MODE_INFO[m].hint}</span>
                      </span>
                      {modeOverride === m && <Check size={14} style={{ color: 'var(--accent)' }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ flex: 1 }} />

          {streaming ? (
            <button type="button" className="coder-send is-stop" onClick={stop} title="Stop" aria-label="Stop">
              <Square size={13} />
            </button>
          ) : (
            <button
              type="button"
              className="coder-send"
              onClick={() => send()}
              disabled={!canSend}
              title={mode === 'fix' ? 'Fix it' : mode === 'improve' ? 'Suggest' : 'Send'}
              aria-label={mode === 'fix' ? 'Fix it' : mode === 'improve' ? 'Suggest' : 'Send'}
            >
              <ArrowRight size={17} />
            </button>
          )}
        </div>
      </div>
      {/* The strip under the box, where the reference shows "Local" */}
      <div className="coder-foot">
        <ModeIcon size={13} style={{ color: MODE_INFO[mode].color }} />
        <span style={{ color: MODE_INFO[mode].color, fontWeight: 600 }}>{MODE_INFO[mode].label}</span>
        <span>{MODE_INFO[mode].hint}</span>
      </div>
    </div>
  );

  return (
    <div
      style={{
        height: 'calc(100vh - 136px)',
        minHeight: 460,
        display: 'grid',
        gridTemplateColumns: viewFile ? 'minmax(0, 1fr) minmax(320px, 42%)' : 'minmax(0, 1fr)',
        gap: 20,
      }}
    >
      {menu && <div style={{ position: 'fixed', inset: 0, zIndex: 25 }} onClick={() => setMenu(null)} />}

      <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        {empty ? (
          /* Start screen: the composer alone, in the middle */
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
            <div className="coder-start" style={{ width: '100%', maxWidth: 780 }}>
              <div style={{ marginBottom: 10, position: 'relative', zIndex: 30 }}>{repoChip}</div>
              <div style={{ position: 'relative', zIndex: menu === 'mode' ? 30 : 'auto' }}>{composer}</div>
              {selectedRepoId && (
                <div className="coder-suggestions">
                  {SUGGESTED.map((s) => (
                    <button key={s.text} type="button" onClick={() => send(s.text, s.mode)} style={{ background: 'transparent' }}>
                      {s.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, position: 'relative', zIndex: 30 }}>
              {repoChip}
              {streaming && currentAgent && (
                <span className="coder-agent">
                  <span className="pulse-dot" />
                  <strong>{currentAgent.agent}</strong> {currentAgent.status}
                </span>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 4px 16px' }}>
              <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
            </div>

            <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', position: 'relative', zIndex: menu === 'mode' ? 30 : 'auto' }}>
              {composer}
            </div>
          </>
        )}
      </section>

      {/* Code viewer: only while a citation is open */}
      {viewFile && (
        <aside style={{ ...glassDense, display: 'flex', flexDirection: 'column', padding: 14, minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace',
              color: '#8FA8A0',
              padding: '0 2px 10px',
            }}
          >
            <FileCode size={13} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{viewFile.path}</span>
            <span style={{ color: '#D9A066', fontWeight: 600, flexShrink: 0 }}>
              L{viewFile.start}-{viewFile.end}
            </span>
            <button
              type="button"
              className="coder-icon-btn"
              onClick={() => setViewFile(null)}
              title="Close"
              aria-label="Close the code viewer"
              style={{ background: 'transparent' }}
            >
              <X size={15} />
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {fileQ.isLoading ? (
              <Loading />
            ) : fileQ.isError ? (
              <ApiErrorView error={fileQ.error} onRetry={() => fileQ.refetch()} />
            ) : fileQ.data ? (
              <CodeViewer
                code={fileCode}
                language="python"
                highlightLines={Array.from({ length: viewFile.end - viewFile.start + 1 }, (_, i) => viewFile.start + i)}
              />
            ) : null}
          </div>
        </aside>
      )}
    </div>
  );
}
