import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost, subscribeRepairEvents, ApiError } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { EmptyState, ErrorBanner, ApiErrorView } from '../components/shared/States';
import { ConfirmDialog } from '../components/shared/Modal';
import type { RepairRun, RepairEvent, RepairRequest, RepairStartResponse } from '../api/types';
import { Check, X } from 'lucide-react';

const FINAL_STATES = ['MERGED', 'REJECTED', 'FAILED'];

export default function RepairPage() {
  const { selectedRepoId } = useRepo();
  const qc = useQueryClient();
  // A run belongs to the repo it was started for; switching repos shows that repo's form.
  const [opened, setOpened] = useState<{ id: string; repo: string } | null>(null);
  const runId = opened && opened.repo === selectedRepoId ? opened.id : null;
  const [issue, setIssue] = useState('');
  const [testCommand, setTestCommand] = useState('');
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [live, setLive] = useState<RepairEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  const startMut = useMutation({
    mutationFn: () => {
      const body: RepairRequest = { issue: issue.trim() };
      if (testCommand.trim()) body.test_command = testCommand.trim();
      return apiPost<RepairStartResponse>(`/api/repos/${selectedRepoId}/repair`, body);
    },
    onSuccess: (d) => openRun(d.run_id),
  });

  function openRun(id: string | null) {
    setLive([]);
    setStreamError(null);
    setOpened(id && selectedRepoId ? { id, repo: selectedRepoId } : null);
  }

  const runQ = useQuery({
    queryKey: ['repair', runId],
    queryFn: () => apiFetch<RepairRun>(`/api/repairs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data && FINAL_STATES.includes(q.state.data.state) ? false : 2000),
  });

  useEffect(() => {
    if (!runId) return;
    return subscribeRepairEvents(runId, {
      // On every (re)connect the server replays the full history, so start from empty.
      onOpen: () => setLive([]),
      onEvent: (e) => setLive((prev) => [...prev, e]),
      onDone: () => qc.invalidateQueries({ queryKey: ['repair', runId] }),
      onError: (e) => setStreamError(e.message),
    });
  }, [runId, qc]);

  const run = runQ.data;
  // The run holds the full history; the live stream may be ahead of the last poll.
  const events = live.length >= (run?.events.length ?? 0) ? live : run!.events;
  const state = run?.state;

  const decide = (action: 'approve' | 'reject') => ({
    mutationFn: () => apiPost<RepairRun>(`/api/repairs/${runId}/${action}`),
    onSuccess: (r: RepairRun) => {
      qc.setQueryData(['repair', runId], r);
      setLive(r.events);
      setConfirm(null);
    },
    onError: () => setConfirm(null),
  });
  const approveMut = useMutation(decide('approve'));
  const rejectMut = useMutation(decide('reject'));

  if (!selectedRepoId) return <EmptyState title="Select a repository" description="Choose a repo in the top bar." />;

  const activeRunId = startMut.error instanceof ApiError && startMut.error.details.repo_id === selectedRepoId
    ? (startMut.error.details.run_id as string | undefined) : undefined;
  const lastEvent = events[events.length - 1];
  const working = !!runId && !['AWAITING_APPROVAL', ...FINAL_STATES].includes(state ?? lastEvent?.state ?? 'CREATED');
  const failReason = [...events].reverse().find((e) => e.kind === 'note' || e.kind === 'error')?.data.reason as string | undefined;

  return (
    <div className="font-sans">
      <div style={{ marginBottom: 28 }}>
        <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px' }}>
          <span className="page-title-accent">REPAIR</span>
          <span>automated fixes</span>
        </h1>
        <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,.12)', margin: '14px 0' }} />
        <p style={{ color: '#8FA8A0', fontSize: 13 }}>Run multi-agent automated repair loops on temporary branches</p>
      </div>

      {!runId && (
        <div className="glass glass-card rounded-[16px] p-6 mb-6" style={{ borderRadius: 16 }}>
          <p className="text-sm text-text-muted mb-4 font-sans leading-relaxed">
            Describe the bug. CodeXray reproduces it with the tests, patches it on a separate branch, and waits for your approval.
          </p>
          <textarea
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            maxLength={4000}
            placeholder="e.g. A loan returned on its due date is reported as overdue"
            className="w-full h-24 p-3.5 rounded-[10px] border border-white/10 bg-white/5 text-sm text-text placeholder:text-text-faint mb-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent-soft"
          />
          <input
            value={testCommand}
            onChange={(e) => setTestCommand(e.target.value)}
            placeholder="Test command (optional, default: python -m pytest -q)"
            className="w-full h-10 px-3 rounded-[10px] border border-white/10 bg-white/5 text-text placeholder:text-text-faint text-xs font-mono mb-4 focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending || !issue.trim()}
            className="px-6 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white text-xs font-semibold tracking-wider uppercase transition-colors disabled:opacity-40 cursor-pointer"
          >
            {startMut.isPending ? 'Starting…' : 'Start repair'}
          </button>
          {startMut.isError && (
            <div className="mt-4">
              <ApiErrorView error={startMut.error} />
              {activeRunId && (
                <button
                  type="button"
                  onClick={() => openRun(activeRunId)}
                  className="px-4 py-1.5 rounded-full border border-border bg-bg-raised text-text text-xs font-medium cursor-pointer"
                >
                  Open the active run
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {runId && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-mono bg-bg-raised border border-border text-text ${
                working ? 'shimmer' : ''
              }`}
            >
              {state ?? lastEvent?.state ?? 'CREATED'}
            </span>
            <span className="text-xs font-mono text-text-muted">
              Attempt {run?.attempt ?? lastEvent?.attempt ?? 1} of {run?.max_attempts ?? 3}
            </span>
            <span className="text-xs font-mono text-text-faint">{runId}</span>
          </div>

          {runQ.isError && <ApiErrorView error={runQ.error} onRetry={() => runQ.refetch()} />}
          {streamError && <ErrorBanner message={streamError} />}

          {run?.root_cause && (
            <div className="glass rounded-[12px] p-3.5 mb-4" style={{ borderRadius: 12 }}>
              <span className="section-label mb-1.5 block">Root cause</span>
              <p className="text-sm text-text">{run.root_cause}</p>
            </div>
          )}

          {run?.repro_test && (
            <div className="glass rounded-[12px] p-3.5 mb-4 border border-[rgba(217,160,102,.45)]" style={{ borderRadius: 12 }}>
              <span className="section-label mb-1.5 block">Reproduction test — written by CodeXray</span>
              <p className="text-xs text-[#D9A066] mb-2">
                No existing test showed this bug, so an AI wrote this one. It failed on the original code and the
                fix must make it pass unchanged. Check that it really tests the bug you described.
              </p>
              <div className="text-xs font-mono text-text-muted mb-1">{run.repro_test.path}</div>
              <pre className="glass-dense p-4 rounded-[10px] text-mono text-xs text-text overflow-auto max-h-72">
                {run.repro_test.code}
              </pre>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-2.5 mb-6">
            {events.map((e, i) => {
              const failed = e.kind === 'error' || (e.kind === 'tests' && Number(e.data.failed) > 0 && e.state !== 'BASELINE');
              return (
                <div
                  key={`${e.ts}-${i}`}
                  className={`event-in border rounded-[10px] p-3.5 transition-colors ${
                    failed ? 'border-accent/40 bg-accent-soft' : 'glass'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-bg-raised border border-border text-text">
                      {e.agent || 'system'}
                    </span>
                    <span className="text-sm font-medium text-text">{e.state}</span>
                    <span className="text-xs font-mono text-text-muted ml-auto">{e.message}</span>
                    <span className="text-xs font-mono uppercase px-2 py-0.5 rounded-full border border-border text-text-faint">
                      {e.kind}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Awaiting Approval */}
          {state === 'AWAITING_APPROVAL' && (
            <div className="glass-strong border-2 border-[rgba(217,160,102,.7)] rounded-[16px] p-6 mb-6 shadow-2xl" style={{ borderRadius: 16 }}>
              <h2 className="card-title text-2xl text-text mb-3 tracking-tight">
                Awaiting approval
              </h2>
              {run?.repro_test && (
                <p className="text-xs text-[#D9A066] mb-4">
                  This patch was judged against the AI-written reproduction test shown above. Approving also adds
                  that test to the approved branch.
                </p>
              )}
              <div className="mb-4">
                <span className="section-label mb-1.5 block">
                  Proposed Diff
                </span>
                <pre className="glass-dense p-4 rounded-[10px] text-mono text-xs text-text overflow-auto">
                  {run?.diff}
                </pre>
              </div>
              <div className="mb-4">
                <span className="section-label mb-1.5 block">
                  Evaluation Checklist
                </span>
                <ul className="space-y-1.5">
                  {run?.eval?.checks.map((c) => (
                    <li key={c.name} className="text-xs font-mono flex items-center gap-2">
                      {c.passed ? (
                        <Check size={14} className="text-text" strokeWidth={2.5} />
                      ) : (
                        <X size={14} className="text-accent" strokeWidth={2.5} />
                      )}
                      <span className={c.passed ? 'text-text' : 'text-accent'}>{c.name}</span>
                      <span className="text-text-faint">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {run?.reviewer_notes && (
                <div className="mb-5 glass rounded-[10px] p-3.5" style={{ borderRadius: 10 }}>
                  <p className="text-sm text-text-muted">{run.reviewer_notes}</p>
                  <p className="text-xs font-mono text-text-faint mt-1">does not override tests</p>
                </div>
              )}
              {(approveMut.isError || rejectMut.isError) && (
                <ApiErrorView error={approveMut.error ?? rejectMut.error} />
              )}
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

          {state === 'MERGED' && (
            <div className="glass rounded-[16px] p-6 mb-6" style={{ borderRadius: 16 }}>
              <h2 className="card-title text-2xl text-text mb-1 tracking-tight">Merged</h2>
              <p className="text-sm text-text-muted">
                Not pushed — local branch only{lastEvent?.data.branch ? `: ${String(lastEvent.data.branch)}` : ''}.
              </p>
            </div>
          )}

          {state === 'REJECTED' && (
            <div className="glass rounded-[16px] p-6 mb-6" style={{ borderRadius: 16 }}>
              <h2 className="card-title text-2xl text-text mb-1 tracking-tight">Rejected</h2>
              <p className="text-sm text-text-muted">The repair branch was deleted.</p>
            </div>
          )}

          {state === 'FAILED' && (
            <div className="glass border border-accent/40 rounded-[16px] p-6 mb-6" style={{ borderRadius: 16 }}>
              <h2 className="card-title text-2xl text-accent mb-1 tracking-tight">Failed</h2>
              <p className="text-sm text-text-muted">{failReason || lastEvent?.message || 'The repair run stopped.'}</p>
            </div>
          )}

          {state && FINAL_STATES.includes(state) && (
            <button
              type="button"
              onClick={() => { openRun(null); startMut.reset(); }}
              className="px-5 py-2 rounded-full border border-border bg-bg-raised text-text text-xs font-medium cursor-pointer"
            >
              New repair
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'approve'}
        message="Approve this patch? It is committed to a new local branch; your current branch is not changed and nothing is pushed."
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
