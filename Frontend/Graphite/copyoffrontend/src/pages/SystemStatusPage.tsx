import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Loading, ErrorBanner } from '../components/shared/States';
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
  if (statusQ.isError) return <ErrorBanner message={(statusQ.error as Error).message} onRetry={() => statusQ.refetch()} />;

  const data = statusQ.data!;
  return (
    <div>
      <h1 className="text-h1 mb-6">System status</h1>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {data.providers.map((p) => {
          const cooldownMs = p.cooldownUntil ? new Date(p.cooldownUntil).getTime() - now : 0;
          return (
            <div key={p.name} className="bg-surface border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-h4">{p.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-caption font-medium ${
                  p.status === 'ok' ? 'bg-success-soft text-success' :
                  p.status === 'cooldown' ? 'bg-warning-soft text-warning' :
                  'bg-surface-muted text-text-muted'
                }`}>{p.status}</span>
              </div>
              <p className="text-body-sm text-text-secondary">{p.model}</p>
              {p.status === 'cooldown' && cooldownMs > 0 && (
                <p className="text-caption text-warning mt-2">cooldown {Math.ceil(cooldownMs / 1000)}s</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="bg-surface border border-border rounded-xl p-4">
        <h2 className="text-h3 mb-3">Recent calls</h2>
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-text-secondary border-b border-border">
              <th className="py-2">Provider</th>
              <th className="py-2">Model</th>
              <th className="py-2">Status</th>
              <th className="py-2">Latency</th>
              <th className="py-2">Cached</th>
              <th className="py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {data.recentCalls.map((c) => {
              const switched = c.status !== 'ok';
              return (
                <tr key={c.id} className={`border-b border-border ${switched ? 'bg-warning-soft' : ''}`}>
                  <td className="py-2">{c.provider}</td>
                  <td className="py-2">{c.model}</td>
                  <td className="py-2">{c.status}</td>
                  <td className="py-2">{c.latencyMs}ms</td>
                  <td className="py-2">{c.cached ? 'yes' : 'no'}</td>
                  <td className="py-2 text-caption text-text-muted">{c.timestamp}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-caption text-text-muted mt-3">Active model: {data.activeModel}</p>
      </div>
    </div>
  );
}
