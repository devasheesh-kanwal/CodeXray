import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch, apiPost } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner, ApiErrorView } from '../components/shared/States';
import { SeverityBadge, DesignBadge } from '../components/shared/Badges';
import { Modal } from '../components/shared/Modal';
import type { Finding, ReviewRequest, ReviewResponse, RulesResponse } from '../api/types';
import { Copy } from 'lucide-react';

type DiffRow = { text: string; kind: 'add' | 'del' | 'ctx' | 'meta'; file: string; newLine: number | null };

/** Split a unified diff into rows that know their file and line number after the change. */
function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let file = '';
  let newLine = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      file = text.slice(4).trim().replace(/^b\//, '');
      rows.push({ text, kind: 'meta', file, newLine: null });
    } else if (text.startsWith('--- ') || text.startsWith('diff ') || text.startsWith('index ')) {
      rows.push({ text, kind: 'meta', file, newLine: null });
    } else if (text.startsWith('@@')) {
      newLine = Number(/\+(\d+)/.exec(text)?.[1] ?? 1);
      rows.push({ text, kind: 'meta', file, newLine: null });
    } else if (text.startsWith('+')) {
      rows.push({ text, kind: 'add', file, newLine: newLine++ });
    } else if (text.startsWith('-')) {
      rows.push({ text, kind: 'del', file, newLine: null });
    } else {
      rows.push({ text, kind: 'ctx', file, newLine: newLine++ });
    }
  }
  return rows;
}

const ROW_COLORS: Record<DiffRow['kind'], { bg: string; fg: string }> = {
  add: { bg: 'rgba(48,164,108,.15)', fg: '#DFF5EB' },
  del: { bg: 'rgba(220,31,31,.18)', fg: '#FF9E9E' },
  ctx: { bg: 'transparent', fg: '#DFF5EB' },
  meta: { bg: 'transparent', fg: 'rgba(143,168,160,.65)' },
};

function DiffView({ diff, finding }: { diff: string; finding: Finding }) {
  const rows = parseDiff(diff);
  return (
    <pre style={{ margin: 0, padding: '12px 0', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.6 }}>
      {rows.map((r, i) => {
        const hit = r.newLine === finding.line && r.file === finding.file;
        const c = ROW_COLORS[r.kind];
        return (
          <div
            key={i}
            ref={hit ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
            style={{
              display: 'flex',
              background: hit ? 'rgba(220,31,31,.30)' : c.bg,
              color: c.fg,
              borderLeft: hit ? '3px solid #DC1F1F' : '3px solid transparent',
            }}
          >
            <span style={{ width: 44, textAlign: 'right', paddingRight: 10, color: 'rgba(143,168,160,.45)', userSelect: 'none', flexShrink: 0 }}>
              {r.newLine ?? ''}
            </span>
            <span style={{ whiteSpace: 'pre', paddingRight: 12 }}>{r.text}</span>
          </div>
        );
      })}
    </pre>
  );
}

export default function PRReviewPage() {
  const { selectedRepoId } = useRepo();
  const [mode, setMode] = useState<'paste' | 'branches'>('paste');
  const [diff, setDiff] = useState('');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [reviewedDiff, setReviewedDiff] = useState('');
  const [selected, setSelected] = useState<Finding | null>(null);
  const [sevFilter, setSevFilter] = useState<string>('all');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const rulesQ = useQuery({
    queryKey: ['rules', selectedRepoId],
    queryFn: () => apiFetch<RulesResponse>(`/api/repos/${selectedRepoId}/rules`),
    enabled: rulesOpen && !!selectedRepoId,
  });

  const reviewMut = useMutation({
    mutationFn: async () => {
      setProgress('Reviewing diff…');
      const body: ReviewRequest = mode === 'paste' ? { diff_text: diff } : { base_branch: base.trim(), head_branch: head.trim() };
      return apiPost<ReviewResponse>(`/api/repos/${selectedRepoId}/review`, body);
    },
    onSuccess: (r) => {
      setReview(r);
      setReviewedDiff(mode === 'paste' ? diff : '');
      setSelected(null);
      setProgress(null);
      setApiError(null);
    },
    onError: (e) => {
      setApiError(e);
      setProgress(null);
    },
  });

  function submit() {
    setError(null);
    setApiError(null);
    if (mode === 'paste' && !diff.trim()) {
      setError('Paste a diff');
      return;
    }
    if (mode === 'branches' && (!base.trim() || !head.trim())) {
      setError('Both branches required');
      return;
    }
    reviewMut.mutate();
  }

  const filtered = (review?.findings || []).filter(
    (f) =>
      (sevFilter === 'all' || f.severity === sevFilter) &&
      (catFilter === 'all' || f.category === catFilter),
  );

  if (!selectedRepoId) return <EmptyState title="Select a repository" description="Choose a repo in the top bar." />;

  return (
    <div className="font-sans">
      {/* Page title */}
      <div style={{ marginBottom: 28 }}>
        <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px' }}>
          <span className="page-title-accent">REVIEW</span>
          <span>pull requests</span>
        </h1>
        <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,.12)', margin: '14px 0' }} />
        <p style={{ color: '#8FA8A0', fontSize: 13 }}>Automated diff inspection, architectural rules, and security compliance</p>
      </div>

      {/* Input / Config Box */}
      <div className="glass glass-card rounded-[16px] p-6 mb-6" style={{ borderRadius: 16 }}>
        <div
          style={{
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.10)',
            borderRadius: 999,
            display: 'inline-flex',
            padding: 3,
            marginBottom: 16,
          }}
        >
          <button
            type="button"
            onClick={() => setMode('paste')}
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: mode === 'paste' ? 'var(--accent, #DC1F1F)' : 'transparent',
              color: mode === 'paste' ? '#fff' : 'var(--text-muted, #8FA8A0)',
              transition: 'all 0.15s',
            }}
          >
            Paste diff
          </button>
          <button
            type="button"
            onClick={() => setMode('branches')}
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: mode === 'branches' ? 'var(--accent, #DC1F1F)' : 'transparent',
              color: mode === 'branches' ? '#fff' : 'var(--text-muted, #8FA8A0)',
              transition: 'all 0.15s',
            }}
          >
            Compare branches
          </button>
        </div>

        {mode === 'paste' ? (
          <textarea
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder="Paste unified diff…"
            style={{
              width: '100%',
              height: 160,
              padding: 14,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.07)',
              color: '#DFF5EB',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
              outline: 'none',
              marginBottom: 16,
            }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="base branch (e.g. main)"
              style={{
                height: 40,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,.12)',
                background: 'rgba(255,255,255,.07)',
                color: '#DFF5EB',
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
                outline: 'none',
              }}
            />
            <input
              value={head}
              onChange={(e) => setHead(e.target.value)}
              placeholder="head branch (e.g. feat/repair)"
              style={{
                height: 40,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,.12)',
                background: 'rgba(255,255,255,.07)',
                color: '#DFF5EB',
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
                outline: 'none',
              }}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={reviewMut.isPending}
            style={{
              padding: '8px 24px',
              borderRadius: 999,
              background: 'var(--accent, #DC1F1F)',
              color: '#fff',
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              border: 'none',
              cursor: 'pointer',
              opacity: reviewMut.isPending ? 0.5 : 1,
            }}
          >
            {reviewMut.isPending ? 'Reviewing…' : 'Review'}
          </button>
        </div>

        {progress && <p className="text-xs font-mono text-text-muted mt-3">{progress}</p>}
        {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
        {!!apiError && <div className="mt-4"><ApiErrorView error={apiError} onRetry={submit} /></div>}
      </div>

      {review && (
        <div>
          {/* Summary bar */}
          <div className="glass rounded-[14px] p-4 mb-4 flex items-center justify-between" style={{ borderRadius: 14 }}>
            <span className="text-sm font-sans text-text font-medium">{review.summary}</span>
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              style={{
                padding: '6px 16px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,.12)',
                background: 'rgba(255,255,255,.07)',
                color: 'var(--text, #DFF5EB)',
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Rules
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value)}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,.12)',
                background: '#17181B',
                color: '#DFF5EB',
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,.12)',
                background: '#17181B',
                color: '#DFF5EB',
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All categories</option>
              <option value="bug">Bug</option>
              <option value="security">Security</option>
              <option value="practice">Practice</option>
              <option value="design">Design</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Findings list */}
            <div className="space-y-3">
              {filtered.map((f) => {
                const isSel = selected?.id === f.id;
                return (
                  <div
                    key={f.id}
                    onClick={() => setSelected(f)}
                    className={`glass glass-card rounded-[14px] p-4 cursor-pointer transition-all ${
                      isSel ? 'glass-selected ring-1 ring-accent' : ''
                    }`}
                    style={{
                      borderRadius: 14,
                      borderColor: isSel ? 'var(--accent, #DC1F1F)' : undefined,
                      boxShadow: isSel ? '0 0 20px rgba(217,160,102,0.22), var(--glass-highlight)' : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <SeverityBadge severity={f.severity} />
                      {f.category === 'design' && <DesignBadge />}
                      <span className="card-title text-sm text-text font-semibold">{f.title}</span>
                    </div>
                    <p className="text-xs text-text-muted mb-2 leading-relaxed">{f.explanation}</p>
                    <p className="text-xs font-mono text-text-faint">
                      {f.file}:{f.line} · {f.category} · {f.source} · {Math.round(f.confidence * 100)}%
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <code className="text-xs font-mono bg-white/5 text-text border border-white/10 px-2 py-1 rounded-[6px]">
                        {f.suggested_fix}
                      </code>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(f.suggested_fix);
                          setCopiedId(f.id);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="text-xs font-sans text-text-muted hover:text-text inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy size={11} />
                        <span>{copiedId === f.id ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && <EmptyState title="No findings" description="Diff looks clean under current filters." />}
            </div>

            {/* Diff Viewer panel */}
            <div className="glass-dense rounded-[14px] overflow-auto max-h-[640px]" style={{ borderRadius: 14 }}>
              {selected && reviewedDiff ? (
                <DiffView diff={reviewedDiff} finding={selected} />
              ) : (
                <div className="p-8 h-full flex items-center justify-center">
                  <EmptyState title="Select a finding" description={reviewedDiff ? 'The diff highlights the line it points to.' : 'Branch reviews have no pasted diff to show.'} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      <Modal open={rulesOpen} onClose={() => setRulesOpen(false)} title="Active Rules">
        {rulesQ.isLoading && <Loading />}
        {rulesQ.isError && <ApiErrorView error={rulesQ.error} onRetry={() => rulesQ.refetch()} />}
        <div className="space-y-3 divide-y divide-border/60">
          {rulesQ.data?.rules.map((r) => (
            <div key={r.id} className="pt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="card-title text-sm font-semibold text-text">{r.title} <span className="text-xs font-mono text-text-faint">({r.severity})</span></span>
                <span className={`text-xs font-mono uppercase ${r.enabled ? 'text-text' : 'text-text-faint'}`}>
                  {r.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              <p className="text-xs text-text-muted">{r.description}</p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
