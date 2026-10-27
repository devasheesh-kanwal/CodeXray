import { useQuery } from '@tanstack/react-query';
import { apiFetch, USE_MOCK } from '../../api/client';
import { useRepo } from '../../context/RepoContext';
import type { Repo, LLMStatus } from '../../api/types';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';


export default function Topbar() {
  const { selectedRepoId, setSelectedRepoId, setSelectedRepo } = useRepo();
  const [open, setOpen] = useState(false);

  // Escape closes the repo dropdown (a click outside already does).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

  const repos = useMemo(() => reposQ.data || [], [reposQ.data]);
  const selected = repos.find((r) => r.repo_id === selectedRepoId) || null;
  // The API has no single "active model"; show the model that answered last.
  const activeModel = [...(statusQ.data?.recent_calls || [])].reverse().find((c) => c.ok)?.model;

  useEffect(() => {
    if (repos.length === 0) return;
    const found = repos.find((r) => r.repo_id === selectedRepoId);
    if (found) {
      setSelectedRepo(found);
    } else {
      // Nothing selected yet, or the saved repo is gone: pick the first ready one.
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
    <header
      className="glass"
      style={{
        height: 72,
        borderRadius: 0,
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: '1px solid rgba(255,255,255,.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        flexShrink: 0,
        position: 'relative',
        // .glass clips its children and its blur makes a new stacking context:
        // let the repo dropdown overflow, and keep the bar above the page content.
        overflow: 'visible',
        zIndex: 30,
        // light blur so the spider webs behind stay visible
        background: 'rgba(255,255,255,.025)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      {/* Repo selector */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          id="topbar-repo-selector"
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 16px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,.12)',
            background: open ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.07)',
            color: '#DFF5EB',
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
            cursor: 'pointer',
            transition: 'background 0.18s',
          }}
        >
          <span style={{ color: '#8FA8A0', fontSize: 12 }}>Repo:</span>
          <span style={{ fontWeight: 500 }}>{selected ? selected.name : 'Select repo'}</span>
          <ChevronDown
            size={14}
            style={{
              color: '#8FA8A0',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.18s',
            }}
          />
        </button>

        {open && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              onClick={() => setOpen(false)}
            />
            <div
              className="glass-strong"
              style={{
                position: 'absolute',
                top: 48,
                left: 0,
                width: 260,
                borderRadius: 14,
                zIndex: 50,
                maxHeight: 240,
                overflow: 'auto',
                padding: 6,
                // A blur nested inside the bar's blur cannot see the page behind it, so use
                // a near-opaque fill instead of relying on backdrop-filter.
                background: 'rgba(22,22,26,.96)',
                animation: 'dropdownIn 0.16s ease-out both',
              }}
            >
              {repos.length === 0 && (
                <div style={{ padding: '12px', color: '#8FA8A0', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
                  No repos found
                </div>
              )}
              {repos.map((r) => {
                const rId = r.repo_id;
                const isCur = rId === selectedRepoId;
                return (
                  <button
                    key={rId}
                    type="button"
                    onClick={() => select(r)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontFamily: 'Inter, sans-serif',
                      cursor: 'pointer',
                      background: isCur ? 'rgba(220,31,31,.16)' : 'transparent',
                      color: isCur ? '#DFF5EB' : '#8FA8A0',
                      fontWeight: isCur ? 500 : 400,
                      border: 'none',
                      transition: 'background 0.15s',
                    }}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Right badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 14px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'rgba(255,255,255,.07)',
            color: '#DFF5EB',
            fontSize: 12,
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 500,
          }}
        >
          <span
            className={backendOk && !USE_MOCK ? 'live-dot' : undefined}
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
        {activeModel && (
          <span
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,.10)',
              background: 'rgba(255,255,255,.05)',
              color: '#8FA8A0',
              fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {activeModel}
          </span>
        )}
      </div>
    </header>
  );
}
