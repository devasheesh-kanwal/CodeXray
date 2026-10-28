import { useEffect, useState } from 'react';
import { Check, ChevronDown, Pin, Sparkles } from 'lucide-react';
import { contextLabel, shortName, useModels, useSelectModel } from '../../api/models';
import type { ModelState } from '../../api/types';

const STATE_DOT: Record<ModelState, string> = {
  available: '#30a46c',
  cooldown: '#D9A066',
  no_keys: 'rgba(143,168,160,.45)',
  disabled: '#DC1F1F',
  unavailable: '#DC1F1F',
};
const STATE_TEXT: Record<ModelState, string> = {
  available: '',
  cooldown: 'rate limited, back soon',
  no_keys: 'no API key',
  disabled: 'keys rejected',
  unavailable: 'unavailable',
};

/**
 * Topbar model menu: Auto, or one model every agent tries first (falls back if it fails).
 * `lastModel` is the model that answered last, shown while in Auto.
 */
export default function ModelPicker({ lastModel }: { lastModel?: string }) {
  const modelsQ = useModels();
  const selectM = useSelectModel();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const data = modelsQ.data;
  if (!data) return null;
  const selected = data.selected;
  const providers = [...new Set(data.models.map((m) => m.provider))];

  function pick(model: string | null) {
    selectM.mutate(model);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        id="topbar-model-picker"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected ? 'Picked model (falls back if it fails)' : 'Automatic model choice'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '5px 12px',
          borderRadius: 999,
          border: `1px solid ${selected ? 'rgba(217,160,102,.45)' : 'rgba(255,255,255,.10)'}`,
          background: open ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.05)',
          color: selected ? '#DFF5EB' : '#8FA8A0',
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          cursor: 'pointer',
          maxWidth: 320,
        }}
      >
        {selected ? <Pin size={12} style={{ color: '#D9A066', flexShrink: 0 }} /> : <Sparkles size={12} style={{ flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? shortName(selected) : `Auto${lastModel ? ` · ${shortName(lastModel)}` : ''}`}
        </span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s', flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="Model"
            style={{
              position: 'absolute',
              top: 40,
              right: 0,
              width: 360,
              maxHeight: 460,
              overflowY: 'auto',
              zIndex: 50,
              padding: 6,
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(22,22,26,.98)',
              boxShadow: '0 24px 60px rgba(0,0,0,.55)',
              animation: 'dropdownIn 0.16s ease-out both',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <Option selected={!selected} onClick={() => pick(null)}>
              <Sparkles size={14} style={{ color: '#D9A066', marginTop: 2 }} />
              <span style={{ flex: 1 }}>
                <span style={{ color: '#DFF5EB', fontSize: 13 }}>Auto</span>
                <span style={{ display: 'block', fontSize: 11.5, color: '#8FA8A0', marginTop: 2, lineHeight: 1.4 }}>
                  Each task uses its best model; after a switch it stays on the working one for 5 minutes.
                </span>
              </span>
            </Option>

            {providers.map((provider) => (
              <div key={provider}>
                <p style={{ padding: '10px 10px 4px', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(143,168,160,.6)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {provider}
                </p>
                {data.models.filter((m) => m.provider === provider).map((m) => (
                  <Option key={m.id} selected={selected === m.id} onClick={() => pick(m.id)} muted={m.state === 'no_keys'}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATE_DOT[m.state], flexShrink: 0, marginTop: 6 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', color: '#DFF5EB', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.model}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: '#8FA8A0', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                        {contextLabel(m.max_context)} context{STATE_TEXT[m.state] && ` · ${STATE_TEXT[m.state]}`}
                      </span>
                    </span>
                  </Option>
                ))}
              </div>
            ))}

            <p style={{ padding: '10px 10px 6px', fontSize: 11, color: 'rgba(143,168,160,.7)', lineHeight: 1.45, borderTop: '1px solid rgba(255,255,255,.08)', marginTop: 6 }}>
              A picked model is tried first by every agent; if it fails, the next working model answers.
              In Coder you can also type <code>/model name</code> or <code>/model auto</code>. More providers go in
              <code> .env</code> (EXTRA_PROVIDERS).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Option({ selected, muted, onClick, children }: { selected: boolean; muted?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 10px',
        border: 'none',
        borderRadius: 9,
        background: selected ? 'rgba(220,31,31,.12)' : 'transparent',
        textAlign: 'left',
        cursor: 'pointer',
        opacity: muted ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,.06)'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
      {selected && <Check size={14} style={{ color: '#DC1F1F', marginTop: 2, flexShrink: 0 }} />}
    </button>
  );
}
