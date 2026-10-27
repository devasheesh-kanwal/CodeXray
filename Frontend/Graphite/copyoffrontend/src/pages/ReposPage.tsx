import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import type { Repo, IndexStatus } from '../api/types';

const STAGES = ['cloning', 'parsing', 'graph', 'embedding', 'summaries', 'ready'] as const;

export default function ReposPage() {
  const qc = useQueryClient();
  const reposQ = useQuery({ queryKey: ['repos'], queryFn: () => apiFetch<Repo[]>('/api/repos') });
  const [tab, setTab] = useState<'git' | 'local'>('git');
  const [gitUrl, setGitUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: (body: any) => apiFetch<Repo>('/api/repos', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['repos'] }); setError(null); setGitUrl(''); setLocalPath(''); },
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

  if (reposQ.isLoading) return <Loading />;
  if (reposQ.isError) return <ErrorBanner message={(reposQ.error as Error).message} onRetry={() => reposQ.refetch()} />;

  return (
    <div>
      <h1 className="text-h1 mb-6">Repositories</h1>
      <div className="bg-surface border border-border rounded-xl p-6 mb-6">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('git')} className={`px-3 py-1.5 rounded-lg text-body-sm ${tab === 'git' ? 'bg-accent text-white' : 'bg-surface-muted text-text-secondary'}`}>Git URL</button>
          <button onClick={() => setTab('local')} className={`px-3 py-1.5 rounded-lg text-body-sm ${tab === 'local' ? 'bg-accent text-white' : 'bg-surface-muted text-text-secondary'}`}>Local path</button>
        </div>
        {tab === 'git' ? (
          <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/..." className="w-full h-10 px-3 rounded-md border border-border bg-surface text-body-sm mb-3" />
        ) : (
          <input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/path/to/repo" className="w-full h-10 px-3 rounded-md border border-border bg-surface text-body-sm mb-3" />
        )}
        {error && <ErrorBanner message={error} />}
        <button onClick={submit} disabled={addMut.isPending} className="px-4 py-2 rounded-lg bg-accent text-white text-body-sm font-medium hover:bg-accent-hover disabled:opacity-50">
          {addMut.isPending ? 'Adding…' : 'Add repository'}
        </button>
      </div>

      {reposQ.data && reposQ.data.length === 0 && <EmptyState title="No repositories" description="Add a repo to get started." />}

      <div className="space-y-4">
        {reposQ.data?.map((r) => (
          <RepoCard key={r.id} repo={r} />
        ))}
      </div>
    </div>
  );
}

function RepoCard({ repo }: { repo: Repo }) {
  const statusQ = useQuery({
    queryKey: ['repo-status', repo.id],
    queryFn: () => apiFetch<IndexStatus>(`/api/repos/${repo.id}/status`),
    refetchInterval: repo.status !== 'ready' && repo.status !== 'error' ? 1000 : false,
  });
  const stage = statusQ.data?.stage || repo.status;
  const idx = STAGES.indexOf(stage as any);
  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-h4">{repo.name}</span>
        <span className="text-caption text-text-muted">{repo.url || repo.localPath}</span>
      </div>
      <div className="flex items-center gap-2">
        {STAGES.map((s, i) => {
          const done = idx > i || stage === 'ready';
          const active = idx === i && stage !== 'ready';
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-caption font-medium border ${
                done ? 'bg-success text-white border-success' : active ? 'bg-accent text-white border-accent' : 'bg-surface-muted text-text-muted border-border'
              }`}>
                {i + 1}
              </div>
              <span className="text-caption text-text-secondary hidden md:inline">{s}</span>
              {i < STAGES.length - 1 && <div className={`w-6 h-0.5 ${done ? 'bg-success' : 'bg-border'}`} />}
            </div>
          );
        })}
      </div>
      {statusQ.data?.message && <p className="text-caption text-text-muted mt-2">{statusQ.data.message}</p>}
    </div>
  );
}
