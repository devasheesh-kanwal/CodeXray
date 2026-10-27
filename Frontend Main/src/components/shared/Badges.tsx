import type { Finding } from '../../api/types';

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  const map: Record<string, string> = {
    critical: 'bg-danger text-white border-danger',
    high: 'bg-danger-soft text-danger border-danger/20',
    medium: 'bg-warning-soft text-warning border-warning/20',
    low: 'bg-surface-muted text-text-secondary border-border',
    info: 'bg-accent-soft text-accent border-accent/20',
  };
  return <span className={`px-2.5 py-0.5 rounded-full text-caption font-semibold border uppercase tracking-wider ${map[severity]}`}>{severity}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  let level = 'High';
  let color = 'bg-success-soft text-success border-success/30';
  if (confidence < 0.4) {
    level = 'Low';
    color = 'bg-danger-soft text-danger border-danger/30';
  } else if (confidence < 0.75) {
    level = 'Medium';
    color = 'bg-warning-soft text-warning border-warning/30';
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-caption font-medium border ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {level} confidence ({Math.round(confidence * 100)}%)
    </span>
  );
}

export function AnsweredByBadge({ model, provider }: { model: string; provider?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-caption font-medium bg-accent-soft text-accent border border-accent/20">
      <span>answered by</span>
      <span className="font-semibold">{model}</span>
      {provider && <span className="text-accent/60">({provider})</span>}
    </span>
  );
}

export function ProviderBadge({ provider, model }: { provider: string; model?: string }) {
  return (
    <span className="px-2.5 py-0.5 rounded-full text-caption font-medium bg-accent-soft text-accent border border-accent/20">
      {provider}{model ? ` · ${model}` : ''}
    </span>
  );
}

export function CachedBadge({ cached }: { cached: boolean }) {
  if (!cached) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-medium bg-success-soft text-success border border-success/30">
      <span>⚡</span> cached
    </span>
  );
}

export function DesignBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-caption font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-xs">
      ⚠️ Breaks project design
    </span>
  );
}

