import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, subscribeEvents } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { EmptyState, ErrorBanner } from '../components/shared/States';
import { ConfirmDialog } from '../components/shared/Modal';
import type { RepairRun, RepairEvent } from '../api/types';

const AGENT_COLOR: Record<string, string> = {
  Architect: 'bg-accent-soft text-accent',
  Debug: 'bg-accent-soft text-accent',
  Reviewer: 'bg-accent-soft text-accent',
  plain: 'bg-surface-muted text-text-secondary',
};

export default function RepairPage() {
  const { selectedRepoId } = useRepo();
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [events, setEvents] = useState<RepairEvent[]>([]);
  const esRef = useRef<any>(null);

  const startMut = useMutation({
    mutationFn: () => apiFetch<{ runId: string }>('/api/repair/start', { method: 'POST', body: JSON.stringify({ repoId: selectedRepoId }) }),
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
    return () => { es.close(); };
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
    onSuccess: (r) => { qc.setQueryData(['repair', runId], r); setConfirm(null); },
  });
  const rejectMut = useMutation({
    mutationFn: () => apiFetch<RepairRun>(`/api/repair/${runId}/reject`, { method: 'POST' }),
    onSuccess: (r) => { qc.setQueryData(['repair', runId], r); setConfirm(null); },
  });

  if (!selectedRepoId) return <EmptyState title="Select a repository" description="Choose a repo in the top bar." />;

  return (
    <div>
      <h1 className="text-h1 mb-6">Repair</h1>
      {!runId && (
        <div className="bg-surface border border-border rounded-xl p-6">
          <p className="text-body mb-4">Start an automated repair run for the selected repository.</p>
          <button onClick={() => startMut.mutate()} disabled={startMut.isPending} className="px-4 py-2 rounded-lg bg-accent text-white text-body-sm font-medium disabled:opacity-50">
            {startMut.isPending ? 'Starting…' : 'Start repair'}
          </button>
          {startMut.isError && <ErrorBanner message={(startMut.error as Error).message} />}
        </div>
      )}

      {runId && (
        <div>
          {run?.replay && <span className="mb-3 inline-block px-2 py-0.5 rounded-full text-caption font-medium bg-warning-soft text-warning">Replay</span>}
          <div className="mb-3 text-body-sm text-text-secondary">
            Attempt {run?.attempts ?? 1} of {run?.maxAttempts ?? 3}
          </div>

          {/* timeline */}
          <div className="space-y-2 mb-6">
            {events.map((e) => {
              const failed = e.status === 'fail';
              return (
                <div key={e.id} className={`border rounded-lg p-3 ${failed ? 'border-danger bg-danger-soft' : 'border-border bg-surface'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-caption font-medium ${AGENT_COLOR[e.agent || 'plain']}`}>
                      {e.agent === 'plain' ? `${e.agent} code` : e.agent}
                    </span>
                    {e.agent === 'plain' && <span className="text-caption text-text-muted">plain code</span>}
                    <span className="text-body-sm font-medium">{e.state}</span>
                    <span className="text-caption text-text-muted ml-auto">{e.message}</span>
                    <span className={`text-caption font-medium ${e.status === 'pass' || e.status === 'merged' ? 'text-success' : e.status === 'fail' ? 'text-danger' : 'text-text-muted'}`}>
                      {e.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* awaiting approval */}
          {status === 'awaiting_approval' && awaiting && (
            <div className="bg-surface border-2 border-warning rounded-xl p-6 mb-6">
              <h2 className="text-h3 mb-3">Awaiting approval</h2>
              <div className="mb-3">
                <h4 className="text-body-sm font-medium mb-1">Diff</h4>
                <pre className="bg-surface-muted p-3 rounded-md text-mono text-caption overflow-auto">{awaiting.diff}</pre>
              </div>
              <div className="mb-3">
                <h4 className="text-body-sm font-medium mb-1">Eval checklist</h4>
                <ul className="space-y-1">
                  {awaiting.eval?.map((ev, i) => (
                    <li key={i} className={`text-body-sm ${ev.pass ? 'text-success' : 'text-danger'}`}>
                      {ev.pass ? '✓' : '✗'} {ev.name}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mb-4 bg-surface-muted border border-border rounded-lg p-3">
                <p className="text-body-sm text-text-secondary">{awaiting.reviewerOpinion}</p>
                <p className="text-caption text-text-muted mt-1">does not override tests</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setConfirm('approve')} className="px-4 py-2 rounded-lg bg-success text-white text-body-sm">Approve</button>
                <button onClick={() => setConfirm('reject')} className="px-4 py-2 rounded-lg bg-danger text-white text-body-sm">Reject</button>
              </div>
            </div>
          )}

          {status === 'merged' && (
            <div className="bg-success-soft border border-success rounded-xl p-6 mb-6">
              <h2 className="text-h3 text-success mb-2">Merged</h2>
              <p className="text-body-sm text-text-secondary">Not pushed — local branch only</p>
            </div>
          )}

          {status === 'failed' && (
            <div className="bg-danger-soft border border-danger rounded-xl p-6 mb-6">
              <h2 className="text-h3 text-danger mb-2">Failed</h2>
              <p className="text-body-sm text-text-secondary">All attempts exhausted.</p>
              <ul className="mt-2 space-y-1">
                {events.filter((e) => e.status === 'fail').map((e) => (
                  <li key={e.id} className="text-caption text-danger">{e.state}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'approve'}
        message="Approve and merge this change?"
        onConfirm={() => approveMut.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'reject'}
        message="Reject and delete the branch?"
        onConfirm={() => rejectMut.mutate()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
