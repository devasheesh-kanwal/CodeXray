import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { useRepo } from '../../context/RepoContext';
import type { Repo, LLMStatus } from '../../api/types';
import { ChevronDown, Wifi, WifiOff, Check } from 'lucide-react';
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

  // Auto-select first repo if none selected yet
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
  const badge = USE_MOCK ? 'Mock' : backendOk ? 'Live' : 'Backend down';
  const badgeColor = USE_MOCK ? 'bg-amber-100 text-amber-800 border-amber-300' : backendOk ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300';

  return (
    <header className="h-topbar bg-surface border-b border-border flex items-center justify-between px-6 z-40 relative">
      <div className="flex items-center gap-4">
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted text-body-sm shadow-xs transition-colors"
          >
            <span className="text-text-secondary text-caption font-medium">Repo:</span>
            <span className="text-text-primary font-semibold">{selected ? selected.name : 'Select repo'}</span>
            <ChevronDown size={14} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute top-11 left-0 w-72 bg-surface border border-border rounded-xl shadow-lg z-50 py-1.5 overflow-hidden animate-in fade-in duration-150">
                <div className="px-3 py-1.5 text-caption font-medium text-text-muted uppercase tracking-wider border-b border-border">
                  Indexed Repositories
                </div>
                {repos.length === 0 && <div className="p-3 text-caption text-text-muted">No repositories added</div>}
                {repos.map((r) => {
                  const isSelected = r.id === selectedRepoId;
                  return (
                    <button
                      key={r.id}
                      onClick={() => select(r)}
                      className={`w-full text-left px-3.5 py-2.5 hover:bg-surface-muted flex items-center justify-between text-body-sm transition-colors ${
                        isSelected ? 'bg-accent-soft/60 text-accent font-medium' : 'text-text-primary'
                      }`}
                    >
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-caption text-text-muted truncate max-w-[200px]">{r.url || r.localPath}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${r.status === 'ready' ? 'bg-emerald-500' : 'bg-accent animate-pulse'}`} />
                        {isSelected && <Check size={14} className="text-accent" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-semibold border ${badgeColor}`}>
          {USE_MOCK || backendOk ? <Wifi size={12} /> : <WifiOff size={12} />}
          {badge}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          {statusQ.data?.activeModel || 'gpt-4o-mini'}
        </span>
      </div>
    </header>
  );
}

