import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, ApiErrorView } from '../components/shared/States';
import type { Repo, IndexStatus, AddRepoRequest, AddRepoResponse } from '../api/types';
import { ArrowRight, Check, FolderGit2 } from 'lucide-react';

// Stage order from docs/API.md. cloning only runs for git URLs, summaries only when enabled.
const STAGES = ['queued', 'cloning', 'parsing', 'graph', 'bm25', 'embedding', 'summaries', 'ready'] as const;

export default function ReposPage() {
  const qc = useQueryClient();
  const reposQ = useQuery({ queryKey: ['repos'], queryFn: () => apiFetch<Repo[]>('/api/repos') });
  const [tab, setTab] = useState<'git' | 'local'>('git');
  const [gitUrl, setGitUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<unknown>(null);

  const addMut = useMutation({
    mutationFn: (body: AddRepoRequest) => apiPost<AddRepoResponse>('/api/repos', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repos'] });
      setError(null);
      setAddError(null);
      setGitUrl('');
      setLocalPath('');
    },
    onError: (e) => setAddError(e),
  });

  function submit() {
    if (tab === 'git') {
      if (!gitUrl.trim()) {
        setError('Git URL required');
        return;
      }
      addMut.mutate({ git_url: gitUrl.trim() });
    } else {
      if (!localPath.trim()) {
        setError('Local path required');
        return;
      }
      addMut.mutate({ local_path: localPath.trim() });
    }
  }

  if (reposQ.isLoading) return <Loading />;
  if (reposQ.isError) return <ApiErrorView error={reposQ.error} onRetry={() => reposQ.refetch()} />;

  return (
    <div className="font-sans">
      {/* Title */}
      <div className="mb-10">
        <h1 className="flex flex-wrap items-baseline gap-x-3.5">
          <span className="font-display font-bold text-[56px] md:text-[64px] text-accent leading-none">
            INDEX
          </span>
          <span className="font-display font-normal text-[48px] md:text-[56px] text-text leading-none">
            your repositories
          </span>
        </h1>
        <div className="w-16 h-px bg-border my-4" />
        <p className="text-text-muted text-sm font-sans tracking-wide">
          Add a repo and CodeXray maps it for you
        </p>
      </div>

      {/* Add Repository Card */}
      <div className="bg-bg-surface border border-border rounded-[14px] p-[28px] mb-8">
        {/* Segmented Control */}
        <div className="bg-bg-raised p-1 rounded-full inline-flex border border-border mb-5">
          <button
            type="button"
            onClick={() => { setTab('git'); setError(null); }}
            className={`px-5 py-1.5 rounded-full text-[13px] font-sans font-medium transition-colors cursor-pointer ${
              tab === 'git' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            Git URL
          </button>
          <button
            type="button"
            onClick={() => { setTab('local'); setError(null); }}
            className={`px-5 py-1.5 rounded-full text-[13px] font-sans font-medium transition-colors cursor-pointer ${
              tab === 'local' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            Local path
          </button>
        </div>

        {/* Input */}
        {tab === 'git' ? (
          <input
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="https://github.com/..."
            className="w-full h-11 px-4 rounded-[10px] border border-border bg-bg-raised text-text placeholder:text-text-faint text-sm font-sans focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition-all mb-4"
          />
        ) : (
          <input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="/path/to/repo"
            className="w-full h-11 px-4 rounded-[10px] border border-border bg-bg-raised text-text placeholder:text-text-faint text-sm font-sans focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition-all mb-4"
          />
        )}

        {/* Inline validation error */}
        {error && (
          <p className="text-accent text-xs font-sans mb-3">{error}</p>
        )}
        {!!addError && <ApiErrorView error={addError} />}

        {/* Submit button */}
        <button
          type="button"
          onClick={submit}
          disabled={addMut.isPending}
          className="px-6 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] font-sans font-semibold tracking-wider uppercase inline-flex items-center gap-2 group transition-all disabled:opacity-40 cursor-pointer"
        >
          <span>{addMut.isPending ? 'Adding…' : 'Add repository'}</span>
          <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      {/* Empty State */}
      {reposQ.data && reposQ.data.length === 0 && (
        <div className="bg-bg-surface border border-border rounded-[14px] p-12 text-center my-6">
          <FolderGit2 size={42} className="text-text-muted mb-4 mx-auto" />
          <h3 className="font-display font-medium text-xl text-text mb-2">No repositories indexed</h3>
          <p className="text-text-muted text-sm font-sans mb-6 max-w-sm mx-auto">
            Add a repo and CodeXray maps it for you.
          </p>
          <button
            type="button"
            onClick={() => {
              const el = document.querySelector('input');
              el?.focus();
            }}
            className="px-6 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] font-sans font-semibold tracking-wider uppercase inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <span>Add Repository</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* Repos List */}
      <div className="space-y-4">
        {reposQ.data?.map((r) => (
          <RepoCard key={r.repo_id} repo={r} />
        ))}
      </div>
    </div>
  );
}

function RepoCard({ repo }: { repo: Repo }) {
  const { selectedRepoId, setSelectedRepoId, setSelectedRepo } = useRepo();
  const isSelected = selectedRepoId === repo.repo_id;

  const statusQ = useQuery({
    queryKey: ['repo-status', repo.repo_id],
    queryFn: () => apiFetch<IndexStatus>(`/api/repos/${repo.repo_id}/status`),
    // Poll every 1.5 s until indexing finishes, based on the latest status.
    refetchInterval: (q) => {
      const s = q.state.data?.stage ?? repo.status;
      return s === 'ready' || s === 'failed' ? false : 1500;
    },
  });

  const stage = statusQ.data?.stage || repo.status;
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const failed = stage === 'failed';
  const isIndexing = stage !== 'ready' && !failed;

  const filesTotal = statusQ.data?.files_total ?? repo.files_total;
  const filesDone = statusQ.data?.files_done ?? 0;

  return (
    <div
      onClick={() => {
        setSelectedRepoId(repo.repo_id);
        setSelectedRepo(repo);
      }}
      className={`bg-bg-surface border rounded-[14px] p-[28px] transition-all cursor-pointer relative ${
        isSelected
          ? 'border-accent shadow-[0_0_24px_rgba(220,31,31,0.12)]'
          : 'border-border hover:border-border-strong hover:shadow-[0_0_24px_rgba(220,31,31,0.08)]'
      }`}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[24px] text-text tracking-wide mb-1">
            {repo.name}
          </h2>
          <span className="font-mono text-xs text-text-faint">
            {repo.repo_id} · {repo.files_total} files
            {statusQ.data?.search_mode && ` · search: ${statusQ.data.search_mode}`}
          </span>
        </div>

        {/* Status badge at top right: READY (mint outline), INDEXING (red outline) */}
        <div>
          {stage === 'ready' ? (
            <span className="border border-text text-text text-[11px] tracking-widest font-sans font-semibold px-2.5 py-0.5 rounded-full uppercase">
              READY
            </span>
          ) : failed ? (
            <span className="bg-accent text-white text-[11px] tracking-widest font-sans font-semibold px-2.5 py-0.5 rounded-full uppercase">
              FAILED
            </span>
          ) : (
            <span className="border border-accent text-accent text-[11px] tracking-widest font-sans font-semibold px-2.5 py-0.5 rounded-full uppercase animate-pulse">
              INDEXING
            </span>
          )}
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center overflow-x-auto py-2">
        {STAGES.map((s, i) => {
          const done = idx > i || stage === 'ready';
          const active = idx === i && stage !== 'ready';

          return (
            <div key={s} className="flex items-center shrink-0">
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-all ${
                    done
                      ? 'border border-text text-text bg-transparent'
                      : active
                      ? 'bg-accent text-white animate-pulse shadow-[0_0_10px_rgba(220,31,31,0.5)]'
                      : 'border border-border text-text-faint bg-transparent'
                  }`}
                >
                  {done ? <Check size={14} strokeWidth={2.5} /> : i + 1}
                </div>
                <span
                  className={`text-[11px] font-sans tracking-wider uppercase font-medium mt-1.5 ${
                    active ? 'text-text' : done ? 'text-text-muted' : 'text-text-faint'
                  }`}
                >
                  {s}
                </span>
              </div>

              {i < STAGES.length - 1 && (
                <div
                  className={`w-6 md:w-12 h-[2px] mx-1.5 -mt-5 transition-colors ${
                    idx > i || stage === 'ready' ? 'bg-text/60' : 'bg-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {failed && (
        <p className="mt-4 text-xs font-mono text-accent">{statusQ.data?.error || 'Indexing failed.'}</p>
      )}

      {/* Indexing card progress: files_done / files_total with thin red progress bar */}
      {isIndexing && (
        <div className="mt-5 pt-4 border-t border-border flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-xs font-mono text-text-muted">
            <span>indexing repository...</span>
            <span>{filesDone} / {filesTotal} files</span>
          </div>
          <div className="w-full h-1 bg-bg-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${filesTotal ? Math.min(100, Math.round((filesDone / filesTotal) * 100)) : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
