import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, ErrorBanner } from '../components/shared/States';
import type { Repo, IndexStatus } from '../api/types';
import { ArrowRight, Check, FolderGit2 } from 'lucide-react';

const STAGES = ['cloning', 'parsing', 'graph', 'embedding', 'summaries', 'ready'] as const;

/* ── Shared inline style tokens ─────────────────────────────── */
const T = {
  card: {
    background: 'rgba(255,255,255,.055)',
    backdropFilter: 'blur(22px) saturate(160%)',
    WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,.12)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10), inset 0 0 0 1px rgba(255,255,255,.02), 0 12px 44px rgba(0,0,0,.40)',
    borderRadius: 16,
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  input: {
    width: '100%',
    height: 44,
    padding: '0 16px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.12)',
    background: 'rgba(255,255,255,.07)',
    color: '#DFF5EB',
    fontSize: 14,
    fontFamily: 'Inter, sans-serif',
    outline: 'none',
  },
  btnPrimary: {
    padding: '10px 24px',
    borderRadius: 999,
    background: '#DC1F1F',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    border: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    transition: 'opacity 0.18s',
  },
  btnSecondary: {
    padding: '8px 16px',
    borderRadius: 999,
    background: 'rgba(255,255,255,.07)',
    border: '1px solid rgba(255,255,255,.12)',
    color: '#8FA8A0',
    fontSize: 13,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'background 0.18s',
  },
  tabActive: {
    padding: '6px 20px',
    borderRadius: 999,
    background: '#DC1F1F',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
  },
  tabIdle: {
    padding: '6px 20px',
    borderRadius: 999,
    background: 'transparent',
    color: '#8FA8A0',
    fontSize: 13,
    fontFamily: 'Inter, sans-serif',
    border: 'none',
    cursor: 'pointer',
  },
};

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
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Page title */}
      <div style={{ marginBottom: 40 }}>
        <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 14px' }}>
          <span className="page-title-accent">INDEX</span>
          <span>your repositories</span>
        </h1>
        <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,.12)', margin: '16px 0' }} />
        <p style={{ color: '#8FA8A0', fontSize: 13 }}>Add a repo and CodeXray maps it for you</p>
      </div>

      {/* Add Repository Card */}
      <div className="glass-card" style={{ ...T.card, padding: 28, marginBottom: 24 }}>
        {/* Segmented control */}
        <div style={{
          background: 'rgba(255,255,255,.06)',
          border: '1px solid rgba(255,255,255,.10)',
          borderRadius: 999,
          display: 'inline-flex',
          padding: 4,
          marginBottom: 20,
        }}>
          <button type="button" onClick={() => { setTab('git'); setError(null); }}
            style={tab === 'git' ? T.tabActive : T.tabIdle}>Git URL</button>
          <button type="button" onClick={() => { setTab('local'); setError(null); }}
            style={tab === 'local' ? T.tabActive : T.tabIdle}>Local path</button>
        </div>

        {tab === 'git' ? (
          <input
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="https://github.com/..."
            style={{ ...T.input, marginBottom: 16 }}
          />
        ) : (
          <input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="/path/to/repo"
            style={{ ...T.input, marginBottom: 16 }}
          />
        )}

        {error && <p style={{ color: '#FF9E9E', fontSize: 12, marginBottom: 12 }}>{error}</p>}

        <button type="button" onClick={submit} disabled={addMut.isPending}
          style={{ ...T.btnPrimary, opacity: addMut.isPending ? 0.5 : 1 }}>
          <span>{addMut.isPending ? 'Adding…' : 'Add repository'}</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Empty State */}
      {reposQ.data && reposQ.data.length === 0 && (
        <div className="glass-card" style={{ ...T.card, padding: 48, textAlign: 'center', marginBottom: 24 }}>
          <FolderGit2 size={40} style={{ color: '#8FA8A0', marginBottom: 16, display: 'block', margin: '0 auto 16px' }} />
          <h3 className="card-title" style={{ marginBottom: 8 }}>No repositories indexed</h3>
          <p style={{ color: '#8FA8A0', fontSize: 13, marginBottom: 24 }}>Add a repo and CodeXray maps it for you.</p>
          <button type="button" onClick={() => document.querySelector('input')?.focus()}
            style={{ ...T.btnPrimary }}>
            <span>Add Repository</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* Repos List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {reposQ.data?.map((r) => {
          const rId = r.id || (r as any).repo_id;
          return <RepoCard key={rId} repo={r} />;
        })}
      </div>
    </div>
  );
}

function RepoCard({ repo }: { repo: Repo }) {
  const repoId = repo.id || (repo as any).repo_id;
  const { selectedRepoId, setSelectedRepoId, setSelectedRepo } = useRepo();
  const isSelected = selectedRepoId === repoId;

  const statusQ = useQuery({
    queryKey: ['repo-status', repoId],
    queryFn: () => apiFetch<IndexStatus>(`/api/repos/${repoId}/status`),
    refetchInterval: repo.status !== 'ready' && repo.status !== 'error' ? 1000 : false,
  });

  const stage = statusQ.data?.stage || repo.status;
  const idx = STAGES.indexOf(stage as any);
  const isIndexing = stage !== 'ready' && stage !== 'error';

  const rawProgress = statusQ.data?.progress ?? (idx >= 0 ? Math.round(((idx + 1) / STAGES.length) * 100) : 40);
  const filesTotal = (statusQ.data as any)?.files_total ?? repo.totalFiles ?? 48;
  const filesDone = (statusQ.data as any)?.files_done ?? Math.min(filesTotal, Math.round((rawProgress / 100) * filesTotal));

  const cardStyle: React.CSSProperties = {
    background: isSelected ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.055)',
    backdropFilter: 'blur(22px) saturate(160%)',
    WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: isSelected
      ? '1px solid rgba(217,160,102,.45)'
      : '1px solid rgba(255,255,255,.12)',
    boxShadow: isSelected
      ? '0 0 0 1px rgba(217,160,102,.20), 0 16px 50px rgba(179,38,30,.18), inset 0 1px 0 rgba(255,255,255,.10)'
      : 'inset 0 1px 0 rgba(255,255,255,.10), inset 0 0 0 1px rgba(255,255,255,.02), 0 12px 44px rgba(0,0,0,.40)',
    borderRadius: 16,
    padding: 28,
    cursor: 'pointer',
    transition: 'all 0.22s ease',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  };

  return (
    <div
      onClick={() => { setSelectedRepoId(repoId); setSelectedRepo(repo); }}
      style={cardStyle}
      className="glass-card"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <h2 className="card-title" style={{ marginBottom: 4 }}>{repo.name}</h2>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'rgba(143,168,160,.5)' }}>
            {repo.url || repo.localPath}
          </span>
        </div>
        {stage === 'ready' ? (
          <span style={{
            border: '1px solid rgba(48,164,108,.5)', color: '#30a46c',
            fontSize: 11, letterSpacing: '0.14em', fontFamily: 'Inter, sans-serif',
            fontWeight: 600, padding: '2px 10px', borderRadius: 999, textTransform: 'uppercase',
          }}>READY</span>
        ) : (
          <span style={{
            border: '1px solid rgba(220,31,31,.5)', color: '#DC1F1F',
            fontSize: 11, letterSpacing: '0.14em', fontFamily: 'Inter, sans-serif',
            fontWeight: 600, padding: '2px 10px', borderRadius: 999, textTransform: 'uppercase',
            animation: 'pulse 2s infinite',
          }}>INDEXING</span>
        )}
      </div>

      {/* Stage stepper */}
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', paddingBottom: 4 }}>
        {STAGES.map((s, i) => {
          const done = idx > i || stage === 'ready';
          const active = idx === i && stage !== 'ready';
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                  border: done ? '1px solid rgba(48,164,108,.5)' : active ? 'none' : '1px solid rgba(255,255,255,.14)',
                  background: done ? 'rgba(48,164,108,.12)' : active ? '#DC1F1F' : 'transparent',
                  color: done ? '#30a46c' : active ? '#fff' : 'rgba(143,168,160,.5)',
                  boxShadow: active ? '0 0 12px rgba(220,31,31,.5)' : 'none',
                  transition: 'all 0.3s',
                }}>
                  {done ? <Check size={13} strokeWidth={2.5} /> : i + 1}
                </div>
                <span style={{
                  fontSize: 10, fontFamily: 'Inter, sans-serif', letterSpacing: '0.10em',
                  textTransform: 'uppercase', marginTop: 5,
                  color: active ? '#DFF5EB' : done ? '#8FA8A0' : 'rgba(143,168,160,.4)',
                }}>{s}</span>
              </div>
              {i < STAGES.length - 1 && (
                <div style={{
                  width: 32, height: 2, margin: '0 4px', marginBottom: 18,
                  background: idx > i || stage === 'ready'
                    ? 'rgba(48,164,108,.3)'
                    : 'rgba(255,255,255,.08)',
                  transition: 'background 0.3s',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {isIndexing && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#8FA8A0' }}>
            <span>indexing repository...</span>
            <span>{filesDone} / {filesTotal} files</span>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: 'linear-gradient(90deg, #D9A066, #DC1F1F)',
              borderRadius: 999,
              width: `${Math.min(100, Math.round((filesDone / filesTotal) * 100))}%`,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}
