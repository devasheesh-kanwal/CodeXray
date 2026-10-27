import { useEffect } from 'react';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,.65)',
  backdropFilter: 'blur(6px)',
};

const panelStyle: React.CSSProperties = {
  background: '#26272C',
  border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06)',
  maxWidth: 640,
  width: '100%',
  margin: '0 16px',
  maxHeight: '80vh',
  overflow: 'auto',
  padding: 28,
  color: '#DFF5EB',
  fontFamily: 'Inter, sans-serif',
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
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {title && (
          <h3
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: '#DFF5EB',
              marginBottom: 20,
              letterSpacing: '0.02em',
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
      <p style={{ fontSize: 14, color: '#8FA8A0', marginBottom: 24, lineHeight: 1.6 }}>
        {message}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,.12)',
            background: '#202125',
            color: '#8FA8A0',
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
            borderRadius: 8,
            background: '#DC1F1F',
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
