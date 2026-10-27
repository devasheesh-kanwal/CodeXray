import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch, apiPost } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner, ApiErrorView } from '../components/shared/States';
import { SeverityBadge, DesignBadge } from '../components/shared/Badges';
import { Modal } from '../components/shared/Modal';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { Finding, ReviewRequest, ReviewResponse, RulesResponse } from '../api/types';
import { Copy } from 'lucide-react';


const darkDiffStyles = {
  variables: {
    dark: {
      diffViewerBackground: '#000000',
      diffViewerColor: '#CFF1E6',
      addedBackground: 'rgba(207, 241, 230, 0.12)',
      addedColor: '#CFF1E6',
      removedBackground: 'rgba(220, 31, 31, 0.16)',
      removedColor: '#FF8E8E',
      wordAddedBackground: 'rgba(207, 241, 230, 0.25)',
      wordRemovedBackground: 'rgba(220, 31, 31, 0.35)',
      addedGutterBackground: '#0A0A0A',
      removedGutterBackground: '#0A0A0A',
      gutterBackground: '#0A0A0A',
      gutterBackgroundDark: '#050505',
      highlightBackground: 'rgba(220, 31, 31, 0.14)',
      highlightGutterBackground: 'rgba(220, 31, 31, 0.20)',
      codeFoldGutterBackground: '#0A0A0A',
      codeFoldBackground: '#0A0A0A',
      emptyLineBackground: '#000000',
      gutterColor: 'rgba(207, 241, 230, 0.38)',
      addedGutterColor: '#CFF1E6',
      removedGutterColor: '#DC1F1F',
      codeFoldContentColor: 'rgba(207, 241, 230, 0.62)',
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
  const [apiError, setApiError] = useState<unknown>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
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
      <h1 className="font-display font-semibold text-3xl text-text mb-6 tracking-wide">
        PR Review
      </h1>

      {/* Input / Config Box */}
      <div className="bg-bg-surface border border-border rounded-[14px] p-6 mb-6">
        <div className="bg-bg-raised p-1 rounded-full inline-flex border border-border mb-4">
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={`px-4 py-1.5 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer ${
              mode === 'paste' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            Paste diff
          </button>
          <button
            type="button"
            onClick={() => setMode('branches')}
            className={`px-4 py-1.5 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer ${
              mode === 'branches' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            Compare branches
          </button>
        </div>

        {mode === 'paste' ? (
          <textarea
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder="Paste unified diff…"
            className="w-full h-40 p-3.5 rounded-[10px] border border-border bg-bg-raised text-mono text-xs text-text placeholder:text-text-faint mb-4 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent-soft"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="base branch (e.g. main)"
              className="h-10 px-3 rounded-[10px] border border-border bg-bg-raised text-text placeholder:text-text-faint text-xs font-mono focus:outline-none focus:border-accent"
            />
            <input
              value={head}
              onChange={(e) => setHead(e.target.value)}
              placeholder="head branch (e.g. feat/repair)"
              className="h-10 px-3 rounded-[10px] border border-border bg-bg-raised text-text placeholder:text-text-faint text-xs font-mono focus:outline-none focus:border-accent"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={reviewMut.isPending}
            className="px-6 py-2 rounded-full bg-accent hover:bg-accent-hover text-white text-xs font-sans font-semibold tracking-wider uppercase transition-colors disabled:opacity-40 cursor-pointer"
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
          <div className="bg-bg-surface border border-border rounded-[14px] p-4 mb-4 flex items-center justify-between">
            <span className="text-sm font-sans text-text font-medium">{review.summary}</span>
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className="px-4 py-1.5 rounded-full border border-border bg-bg-raised text-text hover:border-border-strong hover:text-white text-xs font-sans font-medium transition-colors cursor-pointer"
            >
              Rules
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value)}
              className="h-9 px-3 rounded-[10px] border border-border bg-bg-raised text-text text-xs font-sans focus:outline-none focus:border-accent cursor-pointer"
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
              className="h-9 px-3 rounded-[10px] border border-border bg-bg-raised text-text text-xs font-sans focus:outline-none focus:border-accent cursor-pointer"
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
              {filtered.map((f) => (
                <div
                  key={f.id}
                  onClick={() => setSelected(f)}
                  className={`bg-bg-surface border rounded-[14px] p-4 cursor-pointer transition-all ${
                    f.category === 'design'
                      ? 'border-warning/50 bg-warning/5'
                      : 'border-border hover:border-border-strong'
                  } ${
                    selected?.id === f.id
                      ? 'ring-1 ring-accent border-accent shadow-[0_0_16px_rgba(220,31,31,0.12)]'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <SeverityBadge severity={f.severity} />
                    {f.category === 'design' && <DesignBadge />}
                    <span className="text-sm font-sans font-medium text-text">{f.title}</span>
                  </div>
                  <p className="text-xs text-text-muted mb-2 leading-relaxed">{f.explanation}</p>
                  <p className="text-xs font-mono text-text-faint">
                    {f.file}:{f.line} · {f.category} · {f.source} · {Math.round(f.confidence * 100)}%
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <code className="text-xs font-mono bg-bg-raised text-text border border-border px-2 py-1 rounded-[6px]">
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
              ))}
              {filtered.length === 0 && <EmptyState title="No findings" description="Diff looks clean under current filters." />}
            </div>

            {/* Diff Viewer panel */}
            <div className="bg-bg-deep border border-border rounded-[14px] overflow-auto max-h-[640px]">
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
        {rulesQ.isError && <ApiErrorView error={rulesQ.error} onRetry={() => rulesQ.refetch()} />}
        <div className="space-y-3 divide-y divide-border/60">
          {rulesQ.data?.rules.map((r) => (
            <div key={r.id} className="pt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-text">{r.title} <span className="text-xs font-mono text-text-faint">({r.severity})</span></span>
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
