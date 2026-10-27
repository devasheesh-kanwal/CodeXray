import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Loading, ErrorBanner } from '../components/shared/States';
import type { LLMStatus } from '../api/types';
import { CheckCircle2, Clock, Ban, ArrowRightLeft, Cpu } from 'lucide-react';


export default function SystemStatusPage() {
  const statusQ = useQuery({
    queryKey: ['llm-status'],
    queryFn: () => apiFetch<LLMStatus>('/api/llm/status'),
    refetchInterval: 4000,
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (statusQ.isLoading) return <Loading label="Loading provider telemetry…" />;
  if (statusQ.isError) return <ErrorBanner message={(statusQ.error as Error).message} onRetry={() => statusQ.refetch()} />;

  const data = statusQ.data!;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">System & AI Providers Status</h1>
          <p className="text-body-sm text-text-secondary">
            Live telemetry, quota health, rate-limit cooldown tracking, and fallback failovers
          </p>
        </div>

        <div className="flex items-center gap-2 bg-surface border border-border px-4 py-2 rounded-xl shadow-xs">
          <Cpu size={16} className="text-accent" />
          <span className="text-caption text-text-secondary">Active Primary Model:</span>
          <span className="text-body-sm font-bold text-text-primary">{data.activeModel}</span>
        </div>
      </div>

      {/* Providers Grid */}
      <div className="grid grid-cols-3 gap-4">
        {data.providers.map((p) => {
          const cooldownMs = p.cooldownUntil ? new Date(p.cooldownUntil).getTime() - now : 0;
          const isOk = p.status === 'ok';
          const isCooldown = p.status === 'cooldown';

          return (
            <div
              key={p.name}
              className={`bg-surface border rounded-2xl p-5 shadow-xs transition-all ${
                isOk
                  ? 'border-emerald-200/80 hover:border-emerald-300'
                  : isCooldown
                  ? 'border-amber-300 bg-amber-50/30'
                  : 'border-border opacity-70'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-body font-bold text-text-primary">{p.name}</span>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-caption font-semibold uppercase tracking-wider ${
                    isOk
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : isCooldown
                      ? 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                      : 'bg-slate-100 text-slate-600 border border-slate-300'
                  }`}
                >
                  {isOk ? <CheckCircle2 size={12} /> : isCooldown ? <Clock size={12} /> : <Ban size={12} />}
                  {p.status}
                </span>
              </div>

              <div className="text-caption font-mono text-text-secondary mb-2">
                Model: <span className="text-text-primary font-semibold">{p.model || '—'}</span>
              </div>

              {isCooldown && cooldownMs > 0 ? (
                <div className="mt-3 pt-2.5 border-t border-amber-200/70 flex items-center justify-between text-caption text-amber-800 font-medium">
                  <span>Cooldown reset in:</span>
                  <span className="font-mono font-bold bg-amber-100 px-2 py-0.5 rounded">
                    {Math.max(0, Math.ceil(cooldownMs / 1000))}s
                  </span>
                </div>
              ) : isOk ? (
                <div className="mt-3 pt-2.5 border-t border-emerald-100 text-[11px] text-emerald-700 font-medium">
                  ✓ Healthy · Low latency response
                </div>
              ) : (
                <div className="mt-3 pt-2.5 border-t border-border text-[11px] text-text-muted">
                  Provider disabled in configuration
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Calls Table */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
          <div>
            <h3 className="text-body font-bold text-text-primary">Recent Provider Calls & Fallbacks</h3>
            <p className="text-caption text-text-secondary">
              Highlights automatic fallbacks when preferred models hit rate limits or cooldowns
            </p>
          </div>

          <div className="flex items-center gap-3 text-caption text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Model fallback switch
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Normal execution
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-body-sm text-left">
            <thead>
              <tr className="text-caption font-bold uppercase tracking-wider text-text-muted border-b border-border">
                <th className="py-3 px-3">Provider</th>
                <th className="py-3 px-3">Model</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Latency</th>
                <th className="py-3 px-3">Cached</th>
                <th className="py-3 px-3 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.recentCalls.map((c) => {
                const isSwitched = c.switched || c.status === 'cooldown';

                return (
                  <tr
                    key={c.id}
                    className={`transition-colors ${
                      isSwitched
                        ? 'bg-amber-50/70 hover:bg-amber-100/50 font-medium'
                        : 'hover:bg-surface-muted/60'
                    }`}
                  >
                    <td className="py-3 px-3 font-semibold text-text-primary flex items-center gap-2">
                      {isSwitched && (
                        <span title="Automatic failover switch">
                          <ArrowRightLeft size={13} className="text-amber-600" />
                        </span>
                      )}
                      <span>{c.provider}</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-caption text-text-secondary">{c.model}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-semibold ${
                          c.status === 'ok'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-caption text-text-secondary">{c.latencyMs}ms</td>
                    <td className="py-3 px-3 text-caption font-medium">
                      {c.cached ? (
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          cached
                        </span>
                      ) : (
                        <span className="text-text-muted">live</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-caption font-mono text-text-muted text-right">{c.timestamp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

