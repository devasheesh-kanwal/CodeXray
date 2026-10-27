import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import { SeverityBadge, DesignBadge } from '../components/shared/Badges';
import { Modal } from '../components/shared/Modal';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { Finding, PRReview, Rule } from '../api/types';
import {
  GitPullRequest,
  ShieldAlert,
  Bug,
  Palette,
  CheckCircle2,
  SlidersHorizontal,
  Copy,
  Check,
  BookOpen,
} from 'lucide-react';


const SAMPLE_DIFFS: { label: string; diff: string }[] = [
  {
    label: 'Design System & Form Validation Diff',
    diff: `diff --git a/src/Button.tsx b/src/Button.tsx
index 45b89a1..a2b3c4d 100644
--- a/src/Button.tsx
+++ b/src/Button.tsx
@@ -4,5 +4,5 @@ export function Button({ label, onClick }: { label: string; onClick: () => void }) {
   return (
     <button
       onClick={onClick}
-      className="px-4 py-2 rounded-lg font-medium bg-accent text-white"
+      style={{ backgroundColor: '#ff5500', color: '#ffffff' }}
       className="px-4 py-2 rounded-lg font-medium"
     >
diff --git a/src/Form.tsx b/src/Form.tsx
index 1928fa3..b48f932 100644
--- a/src/Form.tsx
+++ b/src/Form.tsx
@@ -7,3 +7,5 @@ export function Form({ onSubmit }: { onSubmit: (data: any) => void }) {
   const handleSubmit = (e: React.FormEvent) => {
     e.preventDefault();
+    // Direct pass-through without email validation
+    onSubmit({ email });
   };`,
  },
  {
    label: 'Stream Reader & Error Handling Diff',
    diff: `diff --git a/src/api/client.ts b/src/api/client.ts
index e56b1a2..98fa321 100644
--- a/src/api/client.ts
+++ b/src/api/client.ts
@@ -35,4 +35,5 @@ export async function streamPost(path: string, body: unknown, onEvent: any) {
   const reader = res.body.getReader();
+  // Uncaught promise rejection when stream reader throws on disconnect
+  const chunk = await reader.read();
   return chunk;
 }`,
  },
];

export default function PRReviewPage() {
  const { selectedRepoId, selectedRepo } = useRepo();
  const [mode, setMode] = useState<'paste' | 'branches'>('paste');
  const [diff, setDiff] = useState(SAMPLE_DIFFS[0].diff);
  const [base, setBase] = useState('main');
  const [head, setHead] = useState('feature/login-redesign');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [review, setReview] = useState<PRReview | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [sevFilter, setSevFilter] = useState<string>('all');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const rulesQ = useQuery({ queryKey: ['rules'], queryFn: () => apiFetch<Rule[]>('/api/rules'), enabled: rulesOpen });

  const reviewMut = useMutation({
    mutationFn: async () => {
      setProgress('Routing diff to specialized review agents…');
      await new Promise((r) => setTimeout(r, 400));
      setProgress('Analyzing design tokens, security rules, and AST patterns…');
      const body = mode === 'paste' ? { diff, repoId: selectedRepoId } : { base, head, repoId: selectedRepoId };
      const res = await apiFetch<PRReview>('/api/pr/review', { method: 'POST', body: JSON.stringify(body) });
      setProgress(null);
      return res;
    },
    onSuccess: (r) => {
      setReview(r);
      setProgress(null);
      setError(null);
      if (r.findings && r.findings.length > 0) {
        setSelectedFinding(r.findings[0]);
      }
    },
    onError: (e: any) => {
      setError(e.message || 'Review failed');
      setProgress(null);
    },
  });

  // Automatically trigger a review if no review yet and diff loaded
  useEffect(() => {
    if (!review && !reviewMut.isPending && selectedRepoId) {
      reviewMut.mutate();
    }
  }, [selectedRepoId]);

  function submit() {
    setError(null);
    if (mode === 'paste' && !diff.trim()) {
      setError('Please paste a unified git diff');
      return;
    }
    if (mode === 'branches' && (!base.trim() || !head.trim())) {
      setError('Both base and head branches are required');
      return;
    }
    reviewMut.mutate();
  }

  function copyFix(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Calculate summary counts
  const findings = review?.findings || [];
  const bugCount = findings.filter((f) => f.source === 'bug').length;
  const secCount = findings.filter((f) => f.source === 'security').length;
  const designCount = findings.filter((f) => f.source === 'design' || f.breaks_design).length;
  const practiceCount = findings.filter((f) => f.source === 'practice' || f.source === 'style' || f.source === 'performance').length;

  const filtered = findings.filter((f) => {
    const matchSev = sevFilter === 'all' || f.severity === sevFilter;
    const matchCat =
      catFilter === 'all' ||
      (catFilter === 'design' && (f.source === 'design' || f.breaks_design)) ||
      (catFilter === 'practice' && (f.source === 'practice' || f.source === 'style' || f.source === 'performance')) ||
      f.source === catFilter;
    return matchSev && matchCat;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Pull Request Review</h1>
          <p className="text-body-sm text-text-secondary">
            Automated multi-category analysis: Design System, Security, Bug Detection, and Engineering Practices for <span className="font-semibold text-text-primary">{selectedRepo?.name}</span>
          </p>
        </div>

        <button
          onClick={() => setRulesOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border bg-surface hover:bg-surface-muted text-body-sm font-medium shadow-xs transition-colors"
        >
          <BookOpen size={15} className="text-accent" />
          Project Rules ({rulesQ.data?.length ?? 4})
        </button>
      </div>

      {/* Input Box Card */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setMode('paste')}
              className={`px-4 py-1.5 rounded-full text-caption font-semibold transition-colors ${
                mode === 'paste' ? 'bg-accent text-white shadow-xs' : 'bg-surface-muted text-text-secondary hover:bg-slate-200'
              }`}
            >
              Paste unified diff
            </button>
            <button
              onClick={() => setMode('branches')}
              className={`px-4 py-1.5 rounded-full text-caption font-semibold transition-colors ${
                mode === 'branches' ? 'bg-accent text-white shadow-xs' : 'bg-surface-muted text-text-secondary hover:bg-slate-200'
              }`}
            >
              Compare branches
            </button>
          </div>

          {mode === 'paste' && (
            <div className="flex items-center gap-2">
              <span className="text-caption text-text-muted">Sample diff:</span>
              <select
                onChange={(e) => setDiff(SAMPLE_DIFFS[parseInt(e.target.value, 10)].diff)}
                className="h-8 px-2.5 rounded-lg border border-border text-caption bg-surface focus:outline-none"
              >
                {SAMPLE_DIFFS.map((s, idx) => (
                  <option key={idx} value={idx}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {mode === 'paste' ? (
          <textarea
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder="Paste unified git diff here (e.g. diff --git a/... b/...)..."
            className="w-full h-36 p-3.5 rounded-xl border border-border bg-surface font-mono text-caption text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent mb-4"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-caption font-medium text-text-secondary mb-1">Base branch</label>
              <input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="main"
                className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-caption font-medium text-text-secondary mb-1">Head branch</label>
              <input
                value={head}
                onChange={(e) => setHead(e.target.value)}
                placeholder="feature/branch"
                className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={submit}
            disabled={reviewMut.isPending}
            className="px-6 py-2.5 rounded-xl bg-accent text-white text-body-sm font-semibold hover:bg-accent-hover active:bg-accent-active disabled:opacity-50 transition-all shadow-xs flex items-center gap-2"
          >
            <GitPullRequest size={16} />
            {reviewMut.isPending ? 'Reviewing diff…' : 'Start Review'}
          </button>

          {progress && (
            <div className="flex items-center gap-2 text-caption text-accent font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-accent" />
              {progress}
            </div>
          )}
        </div>

        {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      </div>

      {/* Review Results */}
      {review && (
        <div className="space-y-5">
          {/* Summary Bar with category counts */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
              <div>
                <h3 className="text-body font-bold text-text-primary">Review Findings Summary</h3>
                <p className="text-caption text-text-secondary">{review.summary}</p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal size={14} className="text-text-muted" />
                <select
                  value={sevFilter}
                  onChange={(e) => setSevFilter(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-border text-caption bg-surface focus:outline-none"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-border text-caption bg-surface focus:outline-none"
                >
                  <option value="all">All Categories</option>
                  <option value="bug">Bug</option>
                  <option value="security">Security</option>
                  <option value="practice">Engineering Practice</option>
                  <option value="design">Design System</option>
                </select>
              </div>
            </div>

            {/* Category Counters Grid */}
            <div className="grid grid-cols-4 gap-4">
              <button
                onClick={() => setCatFilter(catFilter === 'bug' ? 'all' : 'bug')}
                className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${
                  catFilter === 'bug'
                    ? 'border-rose-400 bg-rose-50/80 ring-2 ring-rose-200'
                    : 'border-border bg-surface-muted/40 hover:bg-rose-50/40'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                  <Bug size={18} />
                </div>
                <div>
                  <div className="text-caption font-medium text-text-secondary">Bugs</div>
                  <div className="text-lg font-bold text-rose-700">{bugCount} issue{bugCount !== 1 ? 's' : ''}</div>
                </div>
              </button>

              <button
                onClick={() => setCatFilter(catFilter === 'security' ? 'all' : 'security')}
                className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${
                  catFilter === 'security'
                    ? 'border-amber-400 bg-amber-50/80 ring-2 ring-amber-200'
                    : 'border-border bg-surface-muted/40 hover:bg-amber-50/40'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                  <ShieldAlert size={18} />
                </div>
                <div>
                  <div className="text-caption font-medium text-text-secondary">Security</div>
                  <div className="text-lg font-bold text-amber-800">{secCount} issue{secCount !== 1 ? 's' : ''}</div>
                </div>
              </button>

              <button
                onClick={() => setCatFilter(catFilter === 'practice' ? 'all' : 'practice')}
                className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${
                  catFilter === 'practice'
                    ? 'border-blue-400 bg-blue-50/80 ring-2 ring-blue-200'
                    : 'border-border bg-surface-muted/40 hover:bg-blue-50/40'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <div className="text-caption font-medium text-text-secondary">Practice</div>
                  <div className="text-lg font-bold text-blue-700">{practiceCount} issue{practiceCount !== 1 ? 's' : ''}</div>
                </div>
              </button>

              <button
                onClick={() => setCatFilter(catFilter === 'design' ? 'all' : 'design')}
                className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${
                  catFilter === 'design'
                    ? 'border-amber-500 bg-amber-100/80 ring-2 ring-amber-300'
                    : 'border-amber-300 bg-amber-50/60 hover:bg-amber-100/40'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-amber-200 text-amber-900 flex items-center justify-center font-bold">
                  <Palette size={18} />
                </div>
                <div>
                  <div className="text-caption font-bold text-amber-900">Design System</div>
                  <div className="text-lg font-bold text-amber-950">{designCount} violation{designCount !== 1 ? 's' : ''}</div>
                </div>
              </button>
            </div>
          </div>

          {/* Finding Cards & Diff Viewer Split */}
          <div className="grid grid-cols-12 gap-6 items-start">
            {/* Findings List */}
            <div className="col-span-6 space-y-3">
              {filtered.map((f) => {
                const isSelected = selectedFinding?.id === f.id;
                const isDesign = f.breaks_design || f.source === 'design';

                return (
                  <div
                    key={f.id}
                    onClick={() => setSelectedFinding(f)}
                    className={`rounded-2xl p-5 cursor-pointer transition-all border ${
                      isDesign
                        ? isSelected
                          ? 'bg-amber-50/90 border-amber-400 ring-2 ring-amber-400 shadow-md'
                          : 'bg-amber-50/50 border-amber-300 hover:border-amber-400 shadow-xs'
                        : isSelected
                        ? 'bg-surface border-accent ring-2 ring-accent/30 shadow-md'
                        : 'bg-surface border-border hover:border-accent/40 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <SeverityBadge severity={f.severity} />
                      {isDesign && <DesignBadge />}
                      <span className="text-caption font-semibold uppercase tracking-wider text-text-muted">
                        [{f.source}]
                      </span>
                    </div>

                    <h4 className="text-body-sm font-bold text-text-primary mb-1.5">{f.title}</h4>
                    <p className="text-body-sm text-text-secondary mb-3 leading-relaxed">{f.description}</p>

                    {f.file && (
                      <div className="flex items-center gap-1.5 text-caption font-mono text-text-muted mb-3 bg-surface-muted px-2.5 py-1 rounded-md max-w-fit">
                        <span>{f.file}</span>
                        {f.line && <span className="font-bold text-text-primary">:line {f.line}</span>}
                      </div>
                    )}

                    {f.suggested_fix && (
                      <div className="mt-3 pt-3 border-t border-border/70">
                        <div className="text-caption font-semibold text-text-secondary mb-1">Suggested Fix:</div>
                        <div className="flex items-center gap-2">
                          <code className="text-caption bg-surface-muted border border-border px-3 py-1.5 rounded-lg flex-1 font-mono text-text-primary overflow-x-auto">
                            {f.suggested_fix}
                          </code>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyFix(f.id, f.suggested_fix);
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-border text-caption font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center gap-1 transition-colors"
                          >
                            {copiedId === f.id ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                            {copiedId === f.id ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <EmptyState title="No findings" description="No issues matched the active severity or category filter." />
              )}
            </div>

            {/* Diff Viewer with highlighted line */}
            <div className="col-span-6 bg-surface border border-border rounded-2xl p-4 shadow-xs sticky top-6">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
                <span className="text-caption font-bold text-text-primary uppercase tracking-wider">
                  Unified Diff Inspector
                </span>
                {selectedFinding?.line && (
                  <span className="text-caption font-mono font-semibold bg-accent-soft text-accent px-2.5 py-0.5 rounded-full border border-accent/20">
                    Target line: {selectedFinding.line}
                  </span>
                )}
              </div>

              <div className="max-h-[560px] overflow-auto text-caption font-mono rounded-xl border border-border">
                <ReactDiffViewer
                  oldValue={diff || ''}
                  newValue={diff || ''}
                  splitView={false}
                  hideLineNumbers={false}
                  highlightLines={selectedFinding?.line ? ['R' + selectedFinding.line, 'L' + selectedFinding.line] : []}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal Drawer */}
      <Modal open={rulesOpen} onClose={() => setRulesOpen(false)} title="Project Architectural & Design Rules">
        <div className="space-y-4">
          <p className="text-body-sm text-text-secondary">
            These rules are enforced automatically by CodeXray agents during PR review and repair proposal verification.
          </p>
          {rulesQ.isLoading && <Loading label="Loading rules…" />}
          {rulesQ.data?.map((r) => (
            <div key={r.id} className="border border-border rounded-xl p-4 bg-surface-muted/30">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-body-sm font-bold text-text-primary">{r.name}</span>
                <span className={`text-caption font-semibold px-2 py-0.5 rounded-full ${r.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-text-muted'}`}>
                  {r.enabled ? 'Active rule' : 'Disabled'}
                </span>
              </div>
              <p className="text-body-sm text-text-secondary">{r.description}</p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

