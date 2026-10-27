export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-text-secondary text-body-sm py-8">
      <div className="w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-16">
      <h3 className="text-h4 text-text-primary mb-2">{title}</h3>
      {description && <p className="text-body-sm text-text-secondary">{description}</p>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-danger-soft border border-danger rounded-lg p-4 flex items-center justify-between mb-4">
      <span className="text-body-sm text-danger">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="px-3 py-1 rounded-md bg-danger text-white text-caption font-medium hover:opacity-90">
          Retry
        </button>
      )}
    </div>
  );
}
