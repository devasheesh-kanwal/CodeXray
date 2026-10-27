import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import type { Repo, IndexStatus } from '../api/types';
import { Check, FolderGit2, CheckCircle2, Loader2 } from 'lucide-react';

const STAGES = ['cloning', 'parsing', 'graph', 'embedding', 'summaries', 'ready'] as const;

export default function ReposPage() {
  const qc = useQueryClient();
  const { selectedRepoId, setSelectedRepoId, setSelectedRepo } = useRepo();
  const reposQ = useQuery({ queryKey: ['repos'], queryFn: () => apiFetch<Repo[]>('/api/repos') });
  const [tab, setTab] = useState<'git' | 'local'>('git');
  const [gitUrl, setGitUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: (body: any) => apiFetch<Repo>('/api/repos', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (newRepo) => {
      qc.invalidateQueries({ queryKey: ['repos'] });
      setError(null);
      setGitUrl('');
      setLocalPath('');
      setSelectedRepoId(newRepo.id);
      setSelectedRepo(newRepo);
    },
    onError: (e: any) => setError(e.message || 'Failed to add repo'),
  });

  function submit() {
    if (tab === 'git') {
      if (!gitUrl.trim()) { setError('Git URL required'); return; }
      addMut.mutate({ url: gitUrl.trim() });
    } else {
      if (!localPath.trim()) { setError('Local path required'); return; }
      addMut.mutate({ localPath: localPath.trim() });
    }
  }

  function handleSelect(r: Repo) {
    setSelectedRepoId(r.id);
    setSelectedRepo(r);
  }

  if (reposQ.isLoading) return <Loading label="Loading repositories…" />;
  if (reposQ.isError) return <ErrorBanner message={(reposQ.error as Error).message} onRetry={() => reposQ.refetch()} />;

  const repos = reposQ.data || [];

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">Repositories</h1>
          <p className="text-body-sm text-text-secondary mt-1">Manage, index, and monitor repository codebases</p>
        </div>
      </div>

      {/* Add Repository Box */}
      <div className="bg-surface border border-border rounded-2xl p-6 mb-8 shadow-xs">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('git')}
            className={`px-4 py-1.5 rounded-full text-caption font-semibold transition-colors ${
              tab === 'git' ? 'bg-accent text-white shadow-xs' : 'bg-surface-muted text-text-secondary hover:bg-slate-200/60'
            }`}
          >
            Git URL
          </button>
          <button
            onClick={() => setTab('local')}
            className={`px-4 py-1.5 rounded-full text-caption font-semibold transition-colors ${
              tab === 'local' ? 'bg-accent text-white shadow-xs' : 'bg-surface-muted text-text-secondary hover:bg-slate-200/60'
            }`}
          >
            Local path
          </button>
        </div>

        <div className="mb-4">
          {tab === 'git' ? (
            <input
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/..."
              className="w-full h-11 px-4 rounded-xl border border-border bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          ) : (
            <input
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="/Users/dev/my-project"
              className="w-full h-11 px-4 rounded-xl border border-border bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          )}
        </div>

        {error && <ErrorBanner message={error} />}

        <button
          onClick={submit}
          disabled={addMut.isPending}
          className="px-5 py-2.5 rounded-xl bg-accent text-white text-body-sm font-semibold hover:bg-accent-hover active:bg-accent-active disabled:opacity-50 transition-all shadow-xs"
        >
          {addMut.isPending ? 'Adding repository…' : 'Add repository'}
        </button>
      </div>

      {repos.length === 0 && (
        <EmptyState title="No repositories indexed" description="Add a repository above by entering its Git URL or local directory path." />
      )}

      {/* Repositories List */}
      <div className="space-y-4">
        {repos.map((r) => (
          <RepoCard
            key={r.id}
            repo={r}
            isSelected={r.id === selectedRepoId}
            onSelect={() => handleSelect(r)}
          />
        ))}
      </div>
    </div>
  );
}

function RepoCard({
  repo,
  isSelected,
  onSelect,
}: {
  repo: Repo;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const statusQ = useQuery({
    queryKey: ['repo-status', repo.id],
    queryFn: () => apiFetch<IndexStatus>(`/api/repos/${repo.id}/status`),
    refetchInterval: repo.status !== 'ready' && repo.status !== 'error' ? 1200 : false,
  });

  const stage = statusQ.data?.stage || repo.status;
  const idx = STAGES.indexOf(stage as any);
  const filesDone = statusQ.data?.filesDone ?? repo.filesDone ?? (stage === 'ready' ? 42 : 18);
  const totalFiles = statusQ.data?.totalFiles ?? repo.totalFiles ?? 42;
  const percent = Math.min(100, Math.round((filesDone / totalFiles) * 100));

  return (
    <div
      onClick={onSelect}
      className={`bg-surface border rounded-2xl p-6 transition-all cursor-pointer relative shadow-xs hover:border-accent/40 ${
        isSelected ? 'ring-2 ring-accent border-accent shadow-md bg-accent-soft/10' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-accent text-white' : 'bg-surface-muted text-text-secondary'}`}>
            <FolderGit2 size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-h4 text-text-primary">{repo.name}</span>
              {isSelected && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-caption font-semibold bg-accent-soft text-accent border border-accent/20">
                  <Check size={12} /> Active Repo
                </span>
              )}
            </div>
            <div className="text-caption text-text-muted mt-0.5">Click to select for explorer, ask, reviews & repair</div>
          </div>
        </div>
        <span className="text-caption font-mono text-text-muted bg-surface-muted px-2.5 py-1 rounded-md max-w-sm truncate">
          {repo.url || repo.localPath}
        </span>
      </div>

      {/* Stepper Progress */}
      <div className="my-5 overflow-x-auto pb-2">
        <div className="flex items-center gap-2 min-w-[580px]">
          {STAGES.map((s, i) => {
            const isDone = stage === 'ready' || idx > i;
            const isActive = idx === i && stage !== 'ready';
            return (
              <div key={s} className="flex items-center gap-2 flex-1 last:flex-none">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-caption font-semibold transition-colors ${
                      isDone
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : isActive
                        ? 'bg-accent text-white shadow-xs animate-pulse ring-4 ring-accent/20'
                        : 'bg-surface-muted text-text-muted border border-border'
                    }`}
                  >
                    {isDone ? <Check size={14} /> : i + 1}
                  </div>
                  <span
                    className={`text-caption font-medium capitalize ${
                      isDone ? 'text-text-primary' : isActive ? 'text-accent font-semibold' : 'text-text-muted'
                    }`}
                  >
                    {s}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`flex-1 h-0.5 min-w-[20px] transition-colors ${isDone ? 'bg-emerald-500' : 'bg-border'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress & Status Details */}
      <div className="flex items-center justify-between text-body-sm pt-2 border-t border-border/60">
        <div className="flex items-center gap-2">
          {stage === 'ready' ? (
            <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
              <CheckCircle2 size={13} /> ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-accent bg-accent-soft border border-accent/20 px-2.5 py-0.5 rounded-full">
              <Loader2 size={13} className="animate-spin" /> {stage}
            </span>
          )}
          <span className="text-caption text-text-secondary">
            {statusQ.data?.message || (stage === 'ready' ? 'Indexed and ready for queries' : `Currently processing ${stage}...`)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-24 bg-surface-muted h-2 rounded-full overflow-hidden border border-border">
            <div
              className={`h-full transition-all duration-500 ${stage === 'ready' ? 'bg-emerald-500' : 'bg-accent'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-caption font-medium text-text-secondary">
            {filesDone} / {totalFiles} files ({percent}%)
          </span>
        </div>
      </div>
    </div>
  );
}

