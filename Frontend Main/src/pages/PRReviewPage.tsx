import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import { SeverityBadge, DesignBadge } from '../components/shared/Badges';
import { Modal } from '../components/shared/Modal';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { Finding, PRReview, Rule } from '../api/types';
import { Copy } from 'lucide-react';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const darkDiffStyles = {
  variables: {
    dark: {
      diffViewerBackground: '#0B0B0E',
      diffViewerColor: '#DFF5EB',
      addedBackground: 'rgba(48, 164, 108, 0.15)',
      addedColor: '#DFF5EB',
      removedBackground: 'rgba(220, 31, 31, 0.18)',
      removedColor: '#FF9E9E',
      wordAddedBackground: 'rgba(48, 164, 108, 0.28)',
      wordRemovedBackground: 'rgba(220, 31, 31, 0.35)',
      addedGutterBackground: '#0E0E12',
      removedGutterBackground: '#0E0E12',
      gutterBackground: '#0E0E12',
      gutterBackgroundDark: '#08080A',
      highlightBackground: 'rgba(220, 31, 31, 0.14)',
      highlightGutterBackground: 'rgba(220, 31, 31, 0.20)',
      codeFoldGutterBackground: '#0E0E12',
      codeFoldBackground: '#0E0E12',
      emptyLineBackground: '#0B0B0E',
      gutterColor: 'rgba(143, 168, 160, 0.45)',
      addedGutterColor: '#DFF5EB',
      removedGutterColor: '#DC1F1F',
      codeFoldContentColor: 'rgba(143, 168, 160, 0.65)',
    },
  },
  line: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '13px',
    lineHeight: '1.6',
  },
};

export default function PRReviewPage() {
  const { selectedRepoId } = useRepo();
  const [mode, setMode] = useState<'paste' | 'branches'>('paste');
  const [diff, setDiff] = useState('');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [review, setReview] = useState<PRReview | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [sevFilter, setSevFilter] = useState<string>('all');
  const [srcFilter, setSrcFilter] = useState<string>('all');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const rulesQ = useQuery({
    queryKey: ['rules'],
    queryFn: () => apiFetch<Rule[]>('/api/rules'),
    enabled: rulesOpen,
  });

  const sampleMut = useMutation({
    mutationFn: () => apiFetch<{ diff: string }>('/api/pr/sample'),
    onSuccess: (d) => setDiff(d.diff),
  });

  const reviewMut = useMutation({
    mutationFn: async () => {
      setProgress('Submitting…');
      await new Promise((r) => setTimeout(r, 300));
      setProgress('Analyzing diff…');
      const body = mode === 'paste' ? { diff, repoId: selectedRepoId } : { base, head, repoId: selectedRepoId };
      const res = await apiFetch<PRReview>('/api/pr/review', { method: 'POST', body: JSON.stringify(body) });
      setProgress('Done');
      return res;
    },
    onSuccess: (r) => {
      setReview(r);
      setProgress(null);
      setError(null);
    },
    onError: (e: any) => {
      setError(e.message || 'Review failed');
      setProgress(null);
    },
  });

  function submit() {
    setError(null);
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
      (srcFilter === 'all' || f.source === srcFilter),
  );

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
          {USE_MOCK && mode === 'paste' && (
            <button
              type="button"
              onClick={() => sampleMut.mutate()}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,.12)',
                background: 'rgba(255,255,255,.07)',
                color: 'var(--text-muted, #8FA8A0)',
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Load sample
            </button>
          )}
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
              value={srcFilter}
              onChange={(e) => setSrcFilter(e.target.value)}
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
              <option value="all">All sources</option>
              <option value="design">Design</option>
              <option value="security">Security</option>
              <option value="performance">Performance</option>
              <option value="style">Style</option>
              <option value="bug">Bug</option>
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
                      {f.breaks_design && <DesignBadge />}
                      <span className="card-title text-sm text-text font-semibold">{f.title}</span>
                    </div>
                    <p className="text-xs text-text-muted mb-2 leading-relaxed">{f.description}</p>
                    {f.file && (
                      <p className="text-xs font-mono text-text-faint">
                        {f.file}{f.line ? `:${f.line}` : ''}
                      </p>
                    )}
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
              {selected ? (
                <ReactDiffViewer
                  oldValue={diff || ''}
                  newValue={diff || ''}
                  splitView={false}
                  hideLineNumbers={false}
                  useDarkTheme={true}
                  styles={darkDiffStyles}
                  highlightLines={selected.line ? ['R' + selected.line] : []}
                />
              ) : (
                <div className="p-8 h-full flex items-center justify-center">
                  <EmptyState title="Select a finding" description="Diff highlights the selected line." />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      <Modal open={rulesOpen} onClose={() => setRulesOpen(false)} title="Active Rules">
        {rulesQ.isLoading && <Loading />}
        <div className="space-y-3 divide-y divide-border/60">
          {rulesQ.data?.map((r) => (
            <div key={r.id} className="pt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="card-title text-sm font-semibold text-text">{r.name}</span>
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
