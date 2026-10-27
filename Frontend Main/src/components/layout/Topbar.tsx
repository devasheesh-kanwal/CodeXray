import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { useRepo } from '../../context/RepoContext';
import type { Repo, LLMStatus } from '../../api/types';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export default function Topbar() {
  const { selectedRepoId, setSelectedRepoId, setSelectedRepo } = useRepo();
  const [open, setOpen] = useState(false);

  const reposQ = useQuery({
    queryKey: ['repos'],
    queryFn: () => apiFetch<Repo[]>('/api/repos'),
    refetchInterval: 5000,
  });

  const statusQ = useQuery({
    queryKey: ['llm-status'],
    queryFn: () => apiFetch<LLMStatus>('/api/llm/status'),
    refetchInterval: 10000,
    retry: 1,
  });

  const repos = reposQ.data || [];
  const selected = repos.find((r) => r.id === selectedRepoId) || null;

  useEffect(() => {
    if (!selectedRepoId && repos.length > 0) {
      setSelectedRepoId(repos[0].id);
      setSelectedRepo(repos[0]);
    }
  }, [repos, selectedRepoId, setSelectedRepoId, setSelectedRepo]);

  function select(r: Repo) {
    setSelectedRepoId(r.id);
    setSelectedRepo(r);
    setOpen(false);
  }

  const backendOk = USE_MOCK ? true : !!statusQ.data && !statusQ.isError;
  const badge = USE_MOCK ? 'Mock' : backendOk ? 'Backend OK' : 'Backend down';

  return (
    <header className="h-[72px] bg-bg-surface border-b border-border flex items-center justify-between px-8 font-sans z-40 relative">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 px-4 py-2 rounded-full border border-border bg-bg-surface hover:bg-bg-raised text-sm text-text font-sans focus:outline-none focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
        >
          <span className="text-text-muted">Repo:</span>
          <span className="font-medium text-text">{selected ? selected.name : 'Select repo'}</span>
          <ChevronDown size={15} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute top-12 left-0 w-64 bg-bg-surface border border-border rounded-[14px] shadow-2xl z-50 max-h-64 overflow-auto p-1.5 font-sans">
              {repos.length === 0 && <div className="p-3 text-xs text-text-muted">No repos found</div>}
              {repos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => select(r)}
                  className={`w-full text-left px-3 py-2 rounded-[10px] text-sm transition-colors cursor-pointer ${
                    r.id === selectedRepoId
                      ? 'bg-accent-soft text-text font-medium'
                      : 'text-text-muted hover:text-text hover:bg-bg-raised'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Mock/Backend badge: dark pill with mint text, status dot */}
        <span className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-border bg-bg-surface text-xs font-sans text-text font-medium">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              USE_MOCK ? 'bg-accent' : backendOk ? 'bg-text' : 'bg-accent'
            }`}
          />
          {badge}
        </span>
        {/* Active model badge: dark pill with mint text */}
        <span className="px-3.5 py-1.5 rounded-full border border-border bg-bg-surface text-xs font-mono text-text">
          {statusQ.data?.activeModel || '—'}
        </span>
      </div>
    </header>
  );
}
