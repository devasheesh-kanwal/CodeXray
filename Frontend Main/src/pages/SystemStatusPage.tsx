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
      {/* Page title */}
      <div style={{ marginBottom: 28 }}>
        <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px' }}>
          <span className="page-title-accent">SYSTEM</span>
          <span>status & telemetry</span>
        </h1>
        <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,.12)', margin: '14px 0' }} />
        <p style={{ color: '#8FA8A0', fontSize: 13 }}>Live LLM provider status, fallbacks, latency and cache metrics</p>
      </div>

      {/* Provider cards: available = mint, cooldown = amber, no_keys/disabled = red */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        {data.providers.map((p) => {
          const cooldownMs = p.cooldown_until ? new Date(p.cooldown_until).getTime() - now : 0;
          return (
            <div
              key={p.name}
              className="glass glass-card rounded-[16px] p-6"
              style={{ borderRadius: 16 }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="card-title text-xl text-text font-bold tracking-tight capitalize">
                  {p.name}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider ${
                    p.state === 'available'
                      ? 'border border-text/40 text-text'
                      : p.state === 'cooldown'
                      ? 'bg-[rgba(217,160,102,.15)] border border-[rgba(217,160,102,.5)] text-[#D9A066]'
                      : 'border border-accent text-accent'
                  }`}
                >
                  {p.state.replace('_', ' ')}
                </span>
              </div>
              {p.state === 'cooldown' && cooldownMs > 0 && (
                <p className="text-xs font-mono text-[#D9A066] mt-2">
                  cooldown {Math.ceil(cooldownMs / 1000)}s
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent calls table */}
      <div className="glass-dense rounded-[16px] p-6 overflow-hidden" style={{ borderRadius: 16 }}>
        <h2 className="card-title text-xl text-text mb-4 tracking-tight">
          Recent calls
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-left text-text-muted border-b border-border section-label">
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
                      switched ? 'bg-[rgba(217,160,102,.10)] text-[#D9A066]' : 'hover:bg-white/5 text-text'
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
                            : 'bg-[rgba(217,160,102,.15)] border border-[rgba(217,160,102,.4)] text-[#D9A066]'
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
                    <td className="py-2.5 px-3 text-text-faint max-w-[360px]" title={c.switch_reason || undefined}>
                      {/* long provider errors: two lines here, the full text on hover */}
                      <span className="line-clamp-2">{c.switch_reason || '—'}</span>
                    </td>
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
