import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import { SeverityBadge } from '../components/shared/Badges';
import { DesignBadge } from '../components/shared/Badges';
import { Modal } from '../components/shared/Modal';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { Finding, PRReview, Rule } from '../api/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

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

  const rulesQ = useQuery({ queryKey: ['rules'], queryFn: () => apiFetch<Rule[]>('/api/rules'), enabled: rulesOpen });

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
    onSuccess: (r) => { setReview(r); setProgress(null); setError(null); },
    onError: (e: any) => { setError(e.message || 'Review failed'); setProgress(null); },
  });

  function submit() {
    setError(null);
    if (mode === 'paste' && !diff.trim()) { setError('Paste a diff'); return; }
    if (mode === 'branches' && (!base.trim() || !head.trim())) { setError('Both branches required'); return; }
    reviewMut.mutate();
  }

  const filtered = (review?.findings || []).filter((f) => (sevFilter === 'all' || f.severity === sevFilter) && (srcFilter === 'all' || f.source === srcFilter));

  return (
    <div>
      <h1 className="text-h1 mb-6">PR Review</h1>
      <div className="bg-surface border border-border rounded-xl p-6 mb-6">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('paste')} className={`px-3 py-1.5 rounded-lg text-body-sm ${mode === 'paste' ? 'bg-accent text-white' : 'bg-surface-muted'}`}>Paste diff</button>
          <button onClick={() => setMode('branches')} className={`px-3 py-1.5 rounded-lg text-body-sm ${mode === 'branches' ? 'bg-accent text-white' : 'bg-surface-muted'}`}>Compare branches</button>
        </div>
        {mode === 'paste' ? (
          <textarea value={diff} onChange={(e) => setDiff(e.target.value)} placeholder="Paste unified diff…" className="w-full h-40 p-3 rounded-md border border-border bg-surface text-mono text-body-sm mb-3" />
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="base branch" className="h-10 px-3 rounded-md border border-border bg-surface text-body-sm" />
            <input value={head} onChange={(e) => setHead(e.target.value)} placeholder="head branch" className="h-10 px-3 rounded-md border border-border bg-surface text-body-sm" />
          </div>
        )}
        {USE_MOCK && mode === 'paste' && (
          <button onClick={() => sampleMut.mutate()} className="mr-2 px-3 py-2 rounded-lg border border-border text-body-sm hover:bg-surface-muted">Load sample</button>
        )}
        <button onClick={submit} disabled={reviewMut.isPending} className="px-4 py-2 rounded-lg bg-accent text-white text-body-sm font-medium disabled:opacity-50">
          {reviewMut.isPending ? 'Reviewing…' : 'Review'}
        </button>
        {progress && <p className="text-caption text-text-muted mt-2">{progress}</p>}
        {error && <ErrorBanner message={error} />}
      </div>

      {review && (
        <div>
          <div className="bg-surface border border-border rounded-xl p-4 mb-4 flex items-center justify-between">
            <span className="text-body-sm">{review.summary}</span>
            <button onClick={() => setRulesOpen(true)} className="px-3 py-1.5 rounded-lg border border-border text-body-sm hover:bg-surface-muted">Rules</button>
          </div>
          <div className="flex gap-2 mb-4">
            <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="h-9 px-2 rounded-md border border-border text-body-sm">
              <option value="all">All severities</option>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <select value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)} className="h-9 px-2 rounded-md border border-border text-body-sm">
              <option value="all">All sources</option>
              <option value="design">design</option>
              <option value="security">security</option>
              <option value="performance">performance</option>
              <option value="style">style</option>
              <option value="bug">bug</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              {filtered.map((f) => (
                <div
                  key={f.id}
                  onClick={() => setSelected(f)}
                  className={`bg-surface border rounded-xl p-4 cursor-pointer ${f.breaks_design ? 'border-warning bg-warning-soft' : 'border-border'} ${selected?.id === f.id ? 'ring-2 ring-accent' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <SeverityBadge severity={f.severity} />
                    {f.breaks_design && <DesignBadge />}
                    <span className="text-body-sm font-medium">{f.title}</span>
                  </div>
                  <p className="text-body-sm text-text-secondary mb-2">{f.description}</p>
                  {f.file && <p className="text-caption text-text-muted">{f.file}{f.line ? `:${f.line}` : ''}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-caption bg-surface-muted px-2 py-1 rounded">{f.suggested_fix}</code>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(f.suggested_fix); }}
                      className="text-caption text-accent hover:underline"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && <EmptyState title="No findings" />}
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 overflow-auto">
              {selected ? (
                <ReactDiffViewer
                  oldValue={diff || ''}
                  newValue={diff || ''}
                  splitView={false}
                  hideLineNumbers={false}
                  highlightLines={selected.line ? ['R' + selected.line] : []}
                />
              ) : (
                <EmptyState title="Select a finding" description="Diff highlights the selected line." />
              )}
            </div>
          </div>
        </div>
      )}

      <Modal open={rulesOpen} onClose={() => setRulesOpen(false)} title="Rules">
        {rulesQ.isLoading && <Loading />}
        {rulesQ.data?.map((r) => (
          <div key={r.id} className="border-b border-border py-3">
            <div className="flex items-center justify-between">
              <span className="text-body-sm font-medium">{r.name}</span>
              <span className={`text-caption ${r.enabled ? 'text-success' : 'text-text-muted'}`}>{r.enabled ? 'enabled' : 'disabled'}</span>
            </div>
            <p className="text-caption text-text-secondary">{r.description}</p>
          </div>
        ))}
      </Modal>
    </div>
  );
}
