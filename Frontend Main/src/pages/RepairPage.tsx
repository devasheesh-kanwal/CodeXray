import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, subscribeEvents } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { EmptyState, ErrorBanner } from '../components/shared/States';
import { ConfirmDialog } from '../components/shared/Modal';
import type { RepairRun, RepairEvent } from '../api/types';
import { Check, X } from 'lucide-react';

export default function RepairPage() {
  const { selectedRepoId } = useRepo();
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [events, setEvents] = useState<RepairEvent[]>([]);
  const esRef = useRef<any>(null);

  const startMut = useMutation({
    mutationFn: () =>
      apiFetch<{ runId: string }>('/api/repair/start', {
        method: 'POST',
        body: JSON.stringify({ repoId: selectedRepoId }),
      }),
    onSuccess: (d) => {
      setRunId(d.runId);
      setEvents([]);
    },
  });

  const runQ = useQuery({
    queryKey: ['repair', runId],
    queryFn: () => apiFetch<RepairRun>(`/api/repair/${runId}`),
    enabled: !!runId,
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (!runId) return;
    const es = subscribeEvents(`/api/repair/${runId}/events`);
    esRef.current = es;
    es.onmessage = (e: any) => {
      try {
        const ev = JSON.parse(e.data) as RepairEvent;
        setEvents((prev) => (prev.find((x) => x.id === ev.id) ? prev : [...prev, ev]));
      } catch {}
    };
    return () => {
      es.close();
    };
  }, [runId]);

  // merge polled events
  useEffect(() => {
    if (runQ.data?.events) {
      setEvents((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const merged = [...prev];
        for (const e of runQ.data!.events) if (!ids.has(e.id)) merged.push(e);
        return merged;
      });
    }
  }, [runQ.data]);

  const run = runQ.data;
  const status = run?.status;
  const awaiting = events.find((e) => e.type === 'approval' || e.state?.toLowerCase().includes('awaiting'));

  const approveMut = useMutation({
    mutationFn: () => apiFetch<RepairRun>(`/api/repair/${runId}/approve`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(['repair', runId], r);
      setConfirm(null);
    },
  });
  const rejectMut = useMutation({
    mutationFn: () => apiFetch<RepairRun>(`/api/repair/${runId}/reject`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(['repair', runId], r);
      setConfirm(null);
    },
  });

  if (!selectedRepoId) return <EmptyState title="Select a repository" description="Choose a repo in the top bar." />;

  return (
    <div className="font-sans">
      <h1 className="font-display font-semibold text-3xl text-text mb-6 tracking-wide">
        Repair
      </h1>

      {!runId && (
        <div className="bg-bg-surface border border-border rounded-[14px] p-6 mb-6">
          <p className="text-sm text-text-muted mb-4 font-sans leading-relaxed">
            Start an automated repair run on a safe temporary branch for the selected repository.
          </p>
          <button
            type="button"
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
            className="px-6 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white text-xs font-semibold tracking-wider uppercase transition-colors disabled:opacity-40 cursor-pointer"
          >
            {startMut.isPending ? 'Starting…' : 'Start repair'}
          </button>
          {startMut.isError && (
            <div className="mt-4">
              <ErrorBanner message={(startMut.error as Error).message} />
            </div>
          )}
        </div>
      )}

      {runId && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            {run?.replay && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-warning/15 border border-warning text-warning">
                Replay
              </span>
            )}
            <span className="text-xs font-mono text-text-muted">
              Attempt {run?.attempts ?? 1} of {run?.maxAttempts ?? 3}
            </span>
          </div>

          {/* Timeline */}
          <div className="space-y-2.5 mb-6">
            {events.map((e) => {
              const failed = e.status === 'fail';
              const passed = e.status === 'pass' || e.status === 'merged';
              return (
                <div
                  key={e.id}
                  className={`border rounded-[10px] p-3.5 transition-colors ${
                    failed ? 'border-accent/40 bg-accent-soft' : 'border-border bg-bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-bg-raised border border-border text-text">
                      {e.agent === 'plain' ? 'runner' : e.agent || 'system'}
                    </span>
                    <span className="text-sm font-medium text-text">{e.state}</span>
                    <span className="text-xs font-mono text-text-muted ml-auto">{e.message}</span>
                    <span
                      className={`text-xs font-mono font-semibold uppercase px-2 py-0.5 rounded-full ${
                        passed
                          ? 'border border-text/40 text-text'
                          : failed
                          ? 'bg-accent text-white'
                          : 'border border-border text-text-faint'
                      }`}
                    >
                      {e.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Awaiting Approval */}
          {status === 'awaiting_approval' && awaiting && (
            <div className="bg-bg-surface border-2 border-warning/70 rounded-[14px] p-6 mb-6 shadow-xl">
              <h2 className="font-display font-semibold text-2xl text-text mb-3">
                Awaiting approval
              </h2>
              <div className="mb-4">
                <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-1.5">
                  Proposed Diff
                </h4>
                <pre className="bg-bg-deep border border-border p-4 rounded-[10px] text-mono text-xs text-text overflow-auto">
                  {awaiting.diff}
                </pre>
              </div>
              <div className="mb-4">
                <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-1.5">
                  Evaluation Checklist
                </h4>
                <ul className="space-y-1.5">
                  {awaiting.eval?.map((ev, i) => (
                    <li key={i} className="text-xs font-mono flex items-center gap-2">
                      {ev.pass ? (
                        <Check size={14} className="text-text" strokeWidth={2.5} />
                      ) : (
                        <X size={14} className="text-accent" strokeWidth={2.5} />
                      )}
                      <span className={ev.pass ? 'text-text' : 'text-accent'}>{ev.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mb-5 bg-bg-raised border border-border rounded-[10px] p-3.5">
                <p className="text-sm text-text-muted">{awaiting.reviewerOpinion}</p>
                <p className="text-xs font-mono text-text-faint mt-1">does not override tests</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirm('approve')}
                  className="px-6 py-2 rounded-full bg-text hover:opacity-90 text-black font-semibold text-xs tracking-wider uppercase transition-opacity cursor-pointer"
                >
                  Approve & Merge
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm('reject')}
                  className="px-6 py-2 rounded-full border border-accent text-accent hover:bg-accent-soft text-xs font-semibold tracking-wider uppercase transition-colors cursor-pointer"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Merged */}
          {status === 'merged' && (
            <div className="bg-bg-surface border border-text/40 rounded-[14px] p-6 mb-6">
              <h2 className="font-display font-semibold text-2xl text-text mb-1">Merged</h2>
              <p className="text-sm text-text-muted">Not pushed — local branch only.</p>
            </div>
          )}

          {/* Failed */}
          {status === 'failed' && (
            <div className="bg-bg-surface border border-accent/40 rounded-[14px] p-6 mb-6">
              <h2 className="font-display font-semibold text-2xl text-accent mb-1">Failed</h2>
              <p className="text-sm text-text-muted">All attempts exhausted.</p>
              <ul className="mt-3 space-y-1">
                {events
                  .filter((e) => e.status === 'fail')
                  .map((e) => (
                    <li key={e.id} className="text-xs font-mono text-accent">
                      {e.state}: {e.message}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'approve'}
        message="Approve and merge this change into your target branch?"
        onConfirm={() => approveMut.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'reject'}
        message="Reject and discard the repair branch?"
        onConfirm={() => rejectMut.mutate()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
