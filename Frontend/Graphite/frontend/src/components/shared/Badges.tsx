import type { Finding } from '../../api/types';

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  const map: Record<string, string> = {
    critical: 'bg-danger text-white',
    high: 'bg-danger-soft text-danger',
    medium: 'bg-warning-soft text-warning',
    low: 'bg-surface-muted text-text-secondary',
    info: 'bg-accent-soft text-accent',
  };
  return <span className={`px-2 py-0.5 rounded-full text-caption font-medium ${map[severity]}`}>{severity}</span>;
}

export function ProviderBadge({ provider, model }: { provider: string; model?: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-caption font-medium bg-accent-soft text-accent">
      {provider}{model ? ` · ${model}` : ''}
    </span>
  );
}

export function CachedBadge({ cached }: { cached: boolean }) {
  if (!cached) return null;
  return <span className="px-2 py-0.5 rounded-full text-caption font-medium bg-success-soft text-success">cached</span>;
}

export function DesignBadge() {
  return (
    <span className="px-2 py-0.5 rounded-full text-caption font-medium bg-warning-soft text-warning border border-warning">
      Breaks project design
    </span>
  );
}
