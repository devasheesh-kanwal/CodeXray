import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, subscribeEvents } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { EmptyState, ErrorBanner } from '../components/shared/States';
import { ConfirmDialog } from '../components/shared/Modal';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { RepairRun, RepairEvent } from '../api/types';
import {
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Play,
  RotateCcw,
  Check,
  X,
  FileDiff,
} from 'lucide-react';


const PRESET_ISSUES = [
  'TypeError: Cannot read properties of undefined (reading "token") in auth handler during anonymous checkout',
  'IndexError: list index out of range when parsing empty symbol table',
  'Unhandled rejection: network timeout during SSE stream reconnect',
];

export default function RepairPage() {
  const { selectedRepoId, selectedRepo } = useRepo();
  const qc = useQueryClient();
  const [issueDescription, setIssueDescription] = useState(PRESET_ISSUES[0]);
  const [runId, setRunId] = useState<string | null>('run1');
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [events, setEvents] = useState<RepairEvent[]>([]);
  const esRef = useRef<any>(null);

  const startMut = useMutation({
    mutationFn: (desc: string) =>
      apiFetch<{ runId: string }>('/api/repair/start', {
        method: 'POST',
        body: JSON.stringify({ repoId: selectedRepoId, issueDescription: desc }),
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

  // Merge polled events
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

  if (!selectedRepoId) {
    return (
      <EmptyState
        title="No repository selected"
        description="Please select a repository in the top bar to run automated bug diagnostics and repair."
      />
    );
  }

  function handleStart() {
    if (!issueDescription.trim()) return;
    startMut.mutate(issueDescription.trim());
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Automated Repair Agent</h1>
          <p className="text-body-sm text-text-secondary">
            Isolates root cause, generates candidate patch, verifies test checklist, and requests human approval for{' '}
            <span className="font-semibold text-text-primary">{selectedRepo?.name}</span>
          </p>
        </div>

        {run?.replay && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption font-semibold bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs">
            <RotateCcw size={12} /> Replay
          </span>
        )}
      </div>

      {/* Issue Description Input Box */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-xs">
        <label className="block text-body-sm font-bold text-text-primary mb-2">
          Issue Description or Exception Trace:
        </label>
        <textarea
          value={issueDescription}
          onChange={(e) => setIssueDescription(e.target.value)}
          placeholder="Paste error trace or describe the bug to repair..."
          className="w-full h-24 p-3.5 rounded-xl border border-border bg-surface text-body-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent mb-3"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-text-muted">Presets:</span>
            {PRESET_ISSUES.map((pi, idx) => (
              <button
                key={idx}
                onClick={() => setIssueDescription(pi)}
                className="text-[11px] text-text-secondary hover:text-accent bg-surface-muted hover:bg-accent-soft px-2.5 py-1 rounded-md border border-border transition-colors truncate max-w-xs"
              >
                Sample {idx + 1}
              </button>
            ))}
          </div>

          <button
            onClick={handleStart}
            disabled={startMut.isPending || !issueDescription.trim()}
            className="px-6 py-2.5 rounded-xl bg-accent text-white text-body-sm font-semibold hover:bg-accent-hover active:bg-accent-active disabled:opacity-50 transition-all shadow-xs flex items-center gap-2"
          >
            <Play size={15} />
            {startMut.isPending ? 'Diagnosing…' : 'Start Repair Run'}
          </button>
        </div>

        {startMut.isError && <div className="mt-4"><ErrorBanner message={(startMut.error as Error).message} /></div>}
      </div>

      {/* Active Run Display */}
      {runId && (
        <div className="space-y-6">
          {/* Status Header */}
          <div className="flex items-center justify-between bg-surface border border-border rounded-2xl px-6 py-4 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center font-bold">
                <Wrench size={20} />
              </div>
              <div>
                <div className="text-body-sm font-bold text-text-primary">
                  Repair Run #{runId}
                </div>
                <div className="text-caption text-text-secondary">
                  Attempt {run?.attempts ?? 1} of {run?.maxAttempts ?? 3} · Mode: Multi-Agent Synthesis
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-caption font-semibold uppercase tracking-wider ${
                  status === 'merged'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : status === 'failed'
                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}
              >
                {status?.replace('_', ' ')}
              </span>
            </div>
          </div>

          {/* Root Cause Card */}
          {run?.rootCause && (
            <div className="bg-amber-50/70 border border-amber-300/80 rounded-2xl p-5 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-200 text-amber-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <h4 className="text-body-sm font-bold text-amber-950 mb-1">Identified Root Cause</h4>
                  <p className="text-body-sm text-amber-900 leading-relaxed font-medium">{run.rootCause}</p>
                </div>
              </div>
            </div>
          )}

          {/* Live Timeline in Plain Words */}
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-xs">
            <h3 className="text-body font-bold text-text-primary mb-4 pb-2 border-b border-border">
              Agent Diagnostic Timeline
            </h3>

            <div className="space-y-3">
              {events.map((e, idx) => {
                const isPass = e.status === 'pass' || e.status === 'merged';
                const isPending = e.status === 'pending';
                const isFail = e.status === 'fail';

                return (
                  <div
                    key={e.id || idx}
                    className={`rounded-xl p-4 border transition-all ${
                      isPending
                        ? 'border-amber-400 bg-amber-50/40 shadow-xs'
                        : isFail
                        ? 'border-rose-300 bg-rose-50/40'
                        : 'border-border bg-surface'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-caption font-bold ${
                            isPass
                              ? 'bg-emerald-500 text-white'
                              : isPending
                              ? 'bg-amber-500 text-white animate-pulse'
                              : 'bg-rose-500 text-white'
                          }`}
                        >
                          {isPass ? <Check size={14} /> : isPending ? <Clock size={14} /> : <X size={14} />}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-body-sm font-bold text-text-primary">{e.state}</span>
                            <span className="px-2 py-0.5 rounded-full text-caption font-semibold bg-accent-soft text-accent border border-accent/20">
                              {e.agent || 'Agent'} · Attempt {e.attempt || 1}
                            </span>
                          </div>
                          <p className="text-caption text-text-secondary mt-0.5">{e.message}</p>
                        </div>
                      </div>

                      <span className="text-caption font-mono text-text-muted">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Awaiting Human Approval Card */}
          {status === 'awaiting_approval' && awaiting && (
            <div className="bg-surface border-2 border-amber-400 rounded-2xl p-6 shadow-md space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h3 className="text-body font-bold text-text-primary">Human Approval Required</h3>
                    <p className="text-caption text-text-secondary">
                      Verify candidate diff and validation checks before merging locally
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setConfirm('reject')}
                    className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-body-sm font-semibold border border-rose-200 transition-colors flex items-center gap-1.5"
                  >
                    <X size={16} /> Reject Proposal
                  </button>
                  <button
                    onClick={() => setConfirm('approve')}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-body-sm font-semibold shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <Check size={16} /> Approve & Merge
                  </button>
                </div>
              </div>

              {/* Candidate Patch Diff */}
              {awaiting.diff && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-caption font-bold text-text-primary uppercase tracking-wider">
                    <FileDiff size={14} className="text-accent" />
                    <span>Candidate Patch Diff:</span>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-border max-h-72 overflow-y-auto">
                    <ReactDiffViewer
                      oldValue={awaiting.diff}
                      newValue={awaiting.diff}
                      splitView={false}
                      hideLineNumbers={false}
                    />
                  </div>
                </div>
              )}

              {/* Eval Checklist */}
              {awaiting.eval && (
                <div className="bg-surface-muted/60 border border-border rounded-xl p-4">
                  <div className="text-caption font-bold text-text-primary uppercase tracking-wider mb-2.5">
                    Automated Verification Checklist:
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {awaiting.eval.map((ev, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 p-2 rounded-lg text-body-sm font-medium ${
                          ev.pass ? 'text-emerald-800 bg-emerald-50/80' : 'text-rose-800 bg-rose-50/80'
                        }`}
                      >
                        {ev.pass ? (
                          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                        ) : (
                          <XCircle size={16} className="text-rose-600 flex-shrink-0" />
                        )}
                        <span className="truncate">{ev.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviewer Advisory Notes Box */}
              {awaiting.reviewerOpinion && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-caption font-bold text-slate-700 uppercase tracking-wider">
                      Reviewer Advisory Note:
                    </span>
                    <span className="text-[11px] text-slate-400 italic font-medium">
                      advisory, does not override tests
                    </span>
                  </div>
                  <p className="text-body-sm text-slate-700 leading-relaxed">{awaiting.reviewerOpinion}</p>
                </div>
              )}
            </div>
          )}

          {/* Merged Banner */}
          {status === 'merged' && (
            <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={24} className="text-emerald-600" />
                <div>
                  <h3 className="text-body font-bold text-emerald-900">Repair Patch Successfully Merged</h3>
                  <p className="text-body-sm text-emerald-800">
                    Applied cleanly to local branch <code className="bg-emerald-100 px-2 py-0.5 rounded font-mono">repair/{runId}</code>. Not pushed to remote.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Failed Banner */}
          {status === 'failed' && (
            <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <XCircle size={24} className="text-rose-600" />
                <div>
                  <h3 className="text-body font-bold text-rose-900">Repair Run Failed</h3>
                  <p className="text-body-sm text-rose-800">
                    Candidate proposals could not pass regression tests across {run?.maxAttempts ?? 3} attempts.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={confirm === 'approve'}
        message="Approve and apply this repair patch to the local repository branch?"
        onConfirm={() => approveMut.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'reject'}
        message="Reject candidate proposal and terminate repair run?"
        onConfirm={() => rejectMut.mutate()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

