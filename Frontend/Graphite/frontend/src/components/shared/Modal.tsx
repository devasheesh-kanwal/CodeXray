import { useEffect } from 'react';

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-xl shadow-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto p-6">
        {title && <h3 className="text-h3 mb-4">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: { open: boolean; message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title="Confirm">
      <p className="text-body mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-border text-body-sm hover:bg-surface-muted">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-danger text-white text-body-sm hover:opacity-90">Confirm</button>
      </div>
    </Modal>
  );
}
