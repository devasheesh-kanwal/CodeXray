import { useEffect } from 'react';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,.50)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
};

const panelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.09)',
  backdropFilter: 'blur(28px) saturate(160%)',
  WebkitBackdropFilter: 'blur(28px) saturate(160%)',
  border: '1px solid rgba(255,255,255,.12)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10), inset 0 0 0 1px rgba(255,255,255,.02), 0 24px 64px rgba(0,0,0,.7)',
  borderRadius: 16,
  maxWidth: 640,
  width: '100%',
  margin: '0 16px',
  maxHeight: '80vh',
  overflow: 'auto',
  padding: 28,
  color: 'var(--text, #DFF5EB)',
  fontFamily: 'Inter, sans-serif',
  position: 'relative',
};

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="glass-strong" style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {title && (
          <h3
            className="card-title"
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: 'var(--text, #DFF5EB)',
              marginBottom: 20,
            }}
          >
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title="Confirm">
      <p style={{ fontSize: 14, color: 'var(--text-muted, #8FA8A0)', marginBottom: 24, lineHeight: 1.6 }}>
        {message}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 20px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'rgba(255,255,255,.07)',
            color: 'var(--text-muted, #8FA8A0)',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: '8px 20px',
            borderRadius: 999,
            background: 'var(--accent, #DC1F1F)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Confirm
        </button>
      </div>
    </Modal>
  );
}
