import type { Finding } from '../../api/types';

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  const map: Record<string, string> = {
    critical: 'bg-accent text-white',
    high: 'bg-accent text-white',
    medium: 'bg-warning/15 border border-warning text-warning',
    low: 'border border-text text-text',
    info: 'bg-text/10 border border-text/30 text-text',
  };
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-[11px] font-sans font-semibold uppercase tracking-wider inline-flex items-center ${
        map[severity] || 'border border-border text-text-muted'
      }`}
    >
      {severity}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  let level = 'High';
  let badgeStyle = 'border border-text/50 text-text';
  if (confidence < 0.4) {
    level = 'Low';
    badgeStyle = 'bg-accent-soft border border-accent text-accent';
  } else if (confidence < 0.75) {
    level = 'Medium';
    badgeStyle = 'bg-warning/15 border border-warning text-warning';
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono ${badgeStyle}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {level} ({Math.round(confidence * 100)}%)
    </span>
  );
}

export function AnsweredByBadge({ model, provider }: { model: string; provider?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-bg-raised border border-border text-text">
      <span className="text-text-muted">model:</span>
      <span className="font-semibold">{model}</span>
      {provider && <span className="text-text-faint">({provider})</span>}
    </span>
  );
}

export function ProviderBadge({ provider, model }: { provider: string; model?: string }) {
  return (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-bg-raised border border-border text-text inline-flex items-center">
      {provider}{model ? ` · ${model}` : ''}
    </span>
  );
}

export function CachedBadge({ cached }: { cached: boolean }) {
  if (!cached) return null;
  return (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-sans font-medium border border-text/40 text-text inline-flex items-center">
      cached
    </span>
  );
}

export function DesignBadge() {
  return (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-sans font-medium bg-warning/15 border border-warning text-warning inline-flex items-center">
      Breaks project design
    </span>
  );
}
