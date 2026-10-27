import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { useRepo } from '../../context/RepoContext';
import type { Repo, LLMStatus } from '../../api/types';
import { ChevronDown, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';

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

  function select(r: Repo) {
    setSelectedRepoId(r.id);
    setSelectedRepo(r);
    setOpen(false);
  }

  const backendOk = USE_MOCK ? true : !!statusQ.data && !statusQ.isError;
  const badge = USE_MOCK ? 'Mock' : backendOk ? 'Backend OK' : 'Backend down';
  const badgeColor = USE_MOCK ? 'bg-warning-soft text-warning' : backendOk ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger';

  return (
    <header className="h-topbar bg-surface border-b border-border flex items-center justify-between px-6">
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-surface-muted text-body-sm"
        >
          <span className="text-text-secondary">Repo:</span>
          <span className="text-text-primary font-medium">{selected ? selected.name : 'Select repo'}</span>
          <ChevronDown size={16} />
        </button>
        {open && (
          <div className="absolute top-12 left-0 w-64 bg-surface border border-border rounded-lg shadow-md z-50 max-h-64 overflow-auto">
            {repos.length === 0 && <div className="p-3 text-caption text-text-muted">No repos</div>}
            {repos.map((r) => (
              <button
                key={r.id}
                onClick={() => select(r)}
                className="w-full text-left px-3 py-2 hover:bg-surface-muted text-body-sm"
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className={`px-3 py-1 rounded-full text-caption font-medium ${badgeColor}`}>
          {USE_MOCK ? <Wifi size={12} className="inline mr-1" /> : backendOk ? <Wifi size={12} className="inline mr-1" /> : <WifiOff size={12} className="inline mr-1" />}
          {badge}
        </span>
        <span className="px-3 py-1 rounded-full text-caption font-medium bg-accent-soft text-accent">
          {statusQ.data?.activeModel || '—'}
        </span>
      </div>
    </header>
  );
}
