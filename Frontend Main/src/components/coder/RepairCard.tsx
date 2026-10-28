import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost, subscribeRepairEvents } from '../../api/client';
import { ErrorBanner, ApiErrorView } from '../shared/States';
import { ConfirmDialog } from '../shared/Modal';
import type { RepairRun, RepairEvent, EvalCheck } from '../../api/types';
import { Check, X, ChevronDown, Wrench } from 'lucide-react';

const FINAL_STATES = ['MERGED', 'REJECTED', 'FAILED'];

type AttemptResult = { attempt: number; checks: EvalCheck[] | null; passed: boolean; reason?: string };

/** One row per attempt: its eval gate checks (from the `eval` events) or why it stopped before them. */
function attemptResults(events: RepairEvent[]): AttemptResult[] {
  const byAttempt = new Map<number, AttemptResult>();
  for (const e of events) {
    if (e.kind === 'eval' && Array.isArray(e.data.checks)) {
      byAttempt.set(e.attempt, { attempt: e.attempt, checks: e.data.checks as EvalCheck[], passed: e.data.passed === true });
    } else if (e.kind === 'note' && typeof e.data.reason === 'string' && /^Attempt \d+ failed/.test(e.message)) {
      const row = byAttempt.get(e.attempt) ?? { attempt: e.attempt, checks: null, passed: false };
      byAttempt.set(e.attempt, { ...row, passed: false, reason: e.data.reason });
    }
  }
  return [...byAttempt.values()].sort((a, b) => a.attempt - b.attempt);
}

const score = (checks: EvalCheck[]) => `${checks.filter((c) => c.passed).length}/${checks.length}`;

/** The evaluation score: the latest attempt's checklist, then a line per attempt. */
function EvalSummary({ results }: { results: AttemptResult[] }) {
  const latest = [...results].reverse().find((r) => r.checks);
  return (
    <div className="mb-3 rounded-[10px] border border-border p-3">
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <span className="section-label">Evaluation</span>
        {latest?.checks && (
          <span className={`text-sm font-mono font-semibold ${latest.passed ? 'text-[#4CC38A]' : 'text-accent'}`}>
            {score(latest.checks)} checks passed
          </span>
        )}
        {latest && <span className="text-xs font-mono text-text-faint">attempt {latest.attempt}</span>}
      </div>
      {latest?.checks && (
        <ul className="space-y-1 mb-2">
          {latest.checks.map((c) => (
            <li key={c.name} className="text-xs font-mono flex items-center gap-2">
              {c.passed ? <Check size={14} className="text-text" strokeWidth={2.5} /> : <X size={14} className="text-accent" strokeWidth={2.5} />}
              <span className={c.passed ? 'text-text' : 'text-accent'}>{c.name}</span>
              <span className="text-text-faint truncate">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {results.length > 1 || !latest ? (
        <ul className="space-y-0.5 border-t border-border pt-2">
          {results.map((r) => (
            <li key={r.attempt} className="text-xs font-mono text-text-muted flex gap-2">
              <span className="text-text">Attempt {r.attempt}:</span>
              {r.checks ? (
                <span className={r.passed ? 'text-[#4CC38A]' : 'text-accent'}>
                  {score(r.checks)} checks{r.passed ? ', passed' : ', failed'}
                </span>
              ) : (
                <span>not evaluated</span>
              )}
              {r.reason && !r.checks && <span className="text-text-faint truncate">({r.reason})</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One repair run, shown inside the Coder conversation: live state, timeline, and the
 * approve/reject step. It follows the run by id, so it can be reopened at any time.
 */
export default function RepairCard({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [live, setLive] = useState<RepairEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const runQ = useQuery({
    queryKey: ['repair', runId],
    queryFn: () => apiFetch<RepairRun>(`/api/repairs/${runId}`),
    refetchInterval: (q) => (q.state.data && FINAL_STATES.includes(q.state.data.state) ? false : 2000),
  });

  useEffect(() => {
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
  const lastEvent = events[events.length - 1];
  const state = run?.state ?? lastEvent?.state ?? 'CREATED';
  const working = !['AWAITING_APPROVAL', ...FINAL_STATES].includes(state);
  const failReason = [...events].reverse().find((e) => e.kind === 'note' || e.kind === 'error')?.data.reason as string | undefined;
  const results = attemptResults(events);

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

  return (
    <div className="text-sm" style={{ minWidth: 0 }}>
      {/* Header: state, attempt, id */}
      <div className="flex items-center gap-2.5 flex-wrap mb-3">
        <Wrench size={14} className="text-[#D9A066]" />
        <span className="text-xs font-semibold text-text tracking-wide">Repair run</span>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono bg-bg-raised border border-border text-text ${working ? 'shimmer' : ''}`}>
          {state}
        </span>
        <span className="text-xs font-mono text-text-muted">
          attempt {run?.attempt ?? lastEvent?.attempt ?? 1} of {run?.max_attempts ?? 3}
        </span>
        <span className="text-[11px] font-mono text-text-faint ml-auto">{runId}</span>
      </div>

      {runQ.isError && <ApiErrorView error={runQ.error} onRetry={() => runQ.refetch()} />}
      {streamError && <ErrorBanner message={streamError} />}

      {/* What the agents are doing right now */}
      {working && lastEvent && (
        <div className="flex items-center gap-2 text-xs text-[#D9A066] mb-3">
          <span className="pulse-dot inline-block w-2 h-2 rounded-full bg-[#D9A066]" />
          <strong>{lastEvent.agent || 'system'}:</strong>
          <span className="truncate">{lastEvent.message}</span>
        </div>
      )}

      {run?.root_cause && (
        <div className="mb-3">
          <span className="section-label mb-1 block">Root cause</span>
          <p className="text-sm text-text leading-relaxed">{run.root_cause}</p>
        </div>
      )}

      {run?.repro_test && (
        <details className="mb-3 rounded-[10px] border border-[rgba(217,160,102,.45)] p-3">
          <summary className="cursor-pointer text-xs font-semibold text-[#D9A066]">
            Reproduction test written by CodeXray: {run.repro_test.path}
          </summary>
          <p className="text-xs text-[#D9A066] my-2">
            No existing test showed this bug, so an AI wrote this one. It failed on the original code and the
            fix must make it pass unchanged. Check that it really tests the bug you described.
          </p>
          <pre className="glass-dense p-3 rounded-[8px] text-mono text-xs text-text overflow-auto max-h-64">{run.repro_test.code}</pre>
        </details>
      )}

      {/* Timeline, folded by default so the conversation stays readable */}
      {events.length > 0 && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <ChevronDown size={14} style={{ transform: showSteps ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }} />
            {showSteps ? 'Hide' : 'Show'} {events.length} agent steps
          </button>
          {showSteps && (
            <div className="space-y-1.5 mt-2">
              {events.map((e, i) => {
                const failed = e.kind === 'error' || (e.kind === 'tests' && Number(e.data.failed) > 0 && e.state !== 'BASELINE');
                return (
                  <div
                    key={`${e.ts}-${i}`}
                    className={`event-in border rounded-[8px] px-3 py-2 flex items-center gap-2.5 flex-wrap ${failed ? 'border-accent/40 bg-accent-soft' : 'border-border'}`}
                  >
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-bg-raised border border-border text-text">
                      {e.agent || 'system'}
                    </span>
                    <span className="text-xs font-medium text-text">{e.state}</span>
                    <span className="text-xs font-mono text-text-muted ml-auto">{e.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* The score stays visible after the run ends, whatever the outcome */}
      {results.length > 0 && <EvalSummary results={results} />}

      {state === 'AWAITING_APPROVAL' && (
        <div className="rounded-[12px] border-2 border-[rgba(217,160,102,.7)] p-4 mt-1">
          <h3 className="card-title text-lg text-text mb-2">Awaiting your approval</h3>
          {run?.repro_test && (
            <p className="text-xs text-[#D9A066] mb-3">
              This patch was judged against the AI-written reproduction test above. Approving also adds that test
              to the approved branch.
            </p>
          )}
          <span className="section-label mb-1 block">Proposed diff</span>
          <pre className="glass-dense p-3 rounded-[8px] text-mono text-xs text-text overflow-auto max-h-80 mb-3">{run?.diff}</pre>
          {run?.reviewer_notes && (
            <div className="mb-3 rounded-[8px] border border-border p-3">
              <p className="text-sm text-text-muted">{run.reviewer_notes}</p>
              <p className="text-xs font-mono text-text-faint mt-1">does not override tests</p>
            </div>
          )}
          {(approveMut.isError || rejectMut.isError) && <ApiErrorView error={approveMut.error ?? rejectMut.error} />}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirm('approve')}
              className="px-5 py-2 rounded-full bg-text hover:opacity-90 text-black font-semibold text-xs tracking-wider uppercase cursor-pointer"
            >
              Approve &amp; merge
            </button>
            <button
              type="button"
              onClick={() => setConfirm('reject')}
              className="px-5 py-2 rounded-full border border-accent text-accent hover:bg-accent-soft text-xs font-semibold tracking-wider uppercase cursor-pointer"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {state === 'MERGED' && (
        <p className="text-sm text-text">
          <strong>Merged.</strong>{' '}
          <span className="text-text-muted">
            Not pushed: local branch only{lastEvent?.data.branch ? `, ${String(lastEvent.data.branch)}` : ''}.
          </span>
        </p>
      )}
      {state === 'REJECTED' && (
        <p className="text-sm text-text">
          <strong>Rejected.</strong> <span className="text-text-muted">The repair branch was deleted.</span>
        </p>
      )}
      {state === 'FAILED' && (
        <p className="text-sm">
          <strong className="text-accent">Failed.</strong>{' '}
          <span className="text-text-muted">{failReason || lastEvent?.message || 'The repair run stopped.'}</span>
        </p>
      )}

      {/* Dialogs go to <body>: the chat panel's frosted glass would otherwise trap them inside it. */}
      {createPortal(
        <>
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
        </>,
        document.body,
      )}
    </div>
  );
}
