import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Loading, ApiErrorView } from '../components/shared/States';
import type { LLMStatus } from '../api/types';

export default function SystemStatusPage() {
  const statusQ = useQuery({
    queryKey: ['llm-status'],
    queryFn: () => apiFetch<LLMStatus>('/api/llm/status'),
    refetchInterval: 5000,
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (statusQ.isLoading) return <Loading />;
  if (statusQ.isError) return <ApiErrorView error={statusQ.error} onRetry={() => statusQ.refetch()} />;

  const data = statusQ.data!;
  const lastOk = [...data.recent_calls].reverse().find((c) => c.ok);

  return (
    <div className="font-sans">
      <h1 className="font-display font-semibold text-3xl text-text mb-6 tracking-wide">
        System status
      </h1>

      {/* Provider cards: available = mint, cooldown = amber, no_keys/disabled = red */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        {data.providers.map((p) => {
          const cooldownMs = p.cooldown_until ? new Date(p.cooldown_until).getTime() - now : 0;
          return (
            <div key={p.name} className="bg-bg-surface border border-border rounded-[14px] p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="font-display font-semibold text-xl text-text tracking-wide capitalize">
                  {p.name}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider ${
                    p.state === 'available'
                      ? 'border border-text text-text'
                      : p.state === 'cooldown'
                      ? 'bg-warning/15 border border-warning text-warning'
                      : 'border border-accent text-accent'
                  }`}
                >
                  {p.state.replace('_', ' ')}
                </span>
              </div>
              {p.state === 'cooldown' && cooldownMs > 0 && (
                <p className="text-xs font-mono text-warning mt-2">
                  cooldown {Math.ceil(cooldownMs / 1000)}s
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent calls table */}
      <div className="bg-bg-surface border border-border rounded-[14px] p-6 overflow-hidden">
        <h2 className="font-display font-semibold text-xl text-text mb-4 tracking-wide">
          Recent calls
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-left text-text-muted border-b border-border font-sans uppercase tracking-wider text-[11px]">
                <th className="py-2.5 px-3">Lane</th>
                <th className="py-2.5 px-3">Provider</th>
                <th className="py-2.5 px-3">Model</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Latency</th>
                <th className="py-2.5 px-3">Cached</th>
                <th className="py-2.5 px-3">Switch reason</th>
              </tr>
            </thead>
            <tbody>
              {[...data.recent_calls].reverse().map((c, i) => {
                const switched = !c.ok;
                return (
                  <tr
                    key={i}
                    className={`border-b border-border/50 transition-colors ${
                      switched ? 'bg-warning/10 text-warning' : 'hover:bg-bg-raised text-text'
                    }`}
                  >
                    <td className="py-2.5 px-3 text-text-muted">{c.lane}</td>
                    <td className="py-2.5 px-3 font-medium capitalize">{c.provider}</td>
                    <td className="py-2.5 px-3 text-text-muted">{c.model}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold ${
                          c.ok
                            ? 'border border-text/40 text-text'
                            : 'bg-warning/20 border border-warning text-warning'
                        }`}
                      >
                        {c.ok ? 'ok' : 'failed'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-text-muted">{c.latency_ms}ms</td>
                    <td className="py-2.5 px-3">
                      <span className={c.cached ? 'text-text font-medium' : 'text-text-faint'}>
                        {c.cached ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-text-faint">{c.switch_reason || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-mono text-text-faint">
          <span>Last model that answered: {lastOk ? `${lastOk.provider}/${lastOk.model}` : '—'}</span>
          <span>Poll interval: 5s</span>
        </div>
      </div>
    </div>
  );
}
