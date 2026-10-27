export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted, #8FA8A0)', padding: '32px 0', fontSize: 14 }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,.12)',
          borderTopColor: 'var(--accent, #DC1F1F)',
          animation: 'spin 0.75s linear infinite',
        }}
      />
      {label}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '64px 0' }}>
      <h3
        className="card-title"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--text, #DFF5EB)',
          marginBottom: 8,
          fontFamily: 'var(--font-heading)',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h3>
      {description && (
        <p style={{ fontSize: 13, color: 'var(--text-muted, #8FA8A0)', fontFamily: 'Inter, sans-serif' }}>
          {description}
        </p>
      )}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      style={{
        background: 'rgba(220,31,31,.10)',
        border: '1px solid rgba(220,31,31,.30)',
        borderRadius: 10,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <span style={{ fontSize: 13, color: '#FF9E9E', fontFamily: 'Inter, sans-serif' }}>{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            background: 'var(--accent, #DC1F1F)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
