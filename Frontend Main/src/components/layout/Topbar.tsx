import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { useRepo } from '../../context/RepoContext';
import type { Repo, LLMStatus } from '../../api/types';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const S = {
  header: {
    height: '72px',
    background: 'rgba(23,24,27,.92)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(255,255,255,.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 32px',
    position: 'relative' as const,
    zIndex: 40,
    flexShrink: 0,
  },
  pill: (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 16px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,.10)',
    background: active ? 'rgba(220,31,31,.14)' : '#202125',
    color: '#DFF5EB',
    fontSize: '13px',
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'background 0.2s, border-color 0.2s',
  }),
  dropdown: {
    position: 'absolute' as const,
    top: '52px',
    left: 0,
    width: '260px',
    background: '#26272C',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '14px',
    boxShadow: '0 16px 40px rgba(0,0,0,.6)',
    zIndex: 50,
    maxHeight: '240px',
    overflow: 'auto',
    padding: '6px',
  },
  dropdownItem: (selected: boolean) => ({
    width: '100%',
    textAlign: 'left' as const,
    padding: '8px 12px',
    borderRadius: '10px',
    fontSize: '13px',
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'background 0.15s',
    background: selected ? 'rgba(220,31,31,.16)' : 'transparent',
    color: selected ? '#DFF5EB' : '#8FA8A0',
    fontWeight: selected ? 500 : 400,
    border: 'none',
  }),
  badge: (color?: string) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 14px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,.10)',
    background: '#202125',
    color: color || '#DFF5EB',
    fontSize: '12px',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 500,
  }),
} as const;

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
  const selected = repos.find((r) => r.repo_id === selectedRepoId) || null;
  // The model that answered last (the API has no single "active model").
  const activeModel = [...(statusQ.data?.recent_calls || [])].reverse().find((c) => c.ok)?.model;

  useEffect(() => {
    if (!selectedRepoId && repos.length > 0) {
      const first = repos.find((r) => r.status === 'ready') || repos[0];
      setSelectedRepoId(first.repo_id);
      setSelectedRepo(first);
    }
  }, [repos, selectedRepoId, setSelectedRepoId, setSelectedRepo]);

  function select(r: Repo) {
    setSelectedRepoId(r.repo_id);
    setSelectedRepo(r);
    setOpen(false);
  }

  const backendOk = USE_MOCK ? true : !!statusQ.data && !statusQ.isError;
  const badge = USE_MOCK ? 'Mock' : backendOk ? 'Live' : 'Offline';
  const badgeDot = USE_MOCK ? '#8FA8A0' : backendOk ? '#30a46c' : '#DC1F1F';

  return (
    <header style={S.header}>
      {/* Repo selector */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={S.pill(open)}
          id="topbar-repo-selector"
        >
          <span style={{ color: '#8FA8A0', fontSize: '12px' }}>Repo:</span>
          <span style={{ fontWeight: 500 }}>{selected ? selected.name : 'Select repo'}</span>
          <ChevronDown
            size={14}
            style={{
              color: '#8FA8A0',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </button>

        {open && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              onClick={() => setOpen(false)}
            />
            <div style={S.dropdown}>
              {repos.length === 0 && (
                <div style={{ padding: '12px', color: '#8FA8A0', fontSize: '12px' }}>
                  No repos found
                </div>
              )}
              {repos.map((r) => (
                <button
                  key={r.repo_id}
                  type="button"
                  onClick={() => select(r)}
                  style={S.dropdownItem(r.repo_id === selectedRepoId)}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Backend status */}
        <span style={S.badge()}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: badgeDot,
              boxShadow: `0 0 6px ${badgeDot}`,
              flexShrink: 0,
            }}
          />
          {badge}
        </span>
        {/* Active model */}
        {activeModel && (
          <span style={{ ...S.badge(), color: '#8FA8A0', fontSize: '11px' }}>
            {activeModel}
          </span>
        )}
      </div>
    </header>
  );
}
