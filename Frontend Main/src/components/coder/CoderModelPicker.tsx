import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { shortName, useEmbeddings, useModels, useSelectEmbedding, useSelectModel } from '../../api/models';

/**
 * Composer-bar picker, "gpt-oss-120b  NVIDIA": the chat model in bold, the
 * embedding provider muted, and a spinner while an answer is running.
 */
export default function CoderModelPicker({ busy, lastModel }: { busy: boolean; lastModel?: string }) {
  const modelsQ = useModels();
  const embQ = useEmbeddings();
  const selectModel = useSelectModel();
  const selectEmb = useSelectEmbedding();
  const [open, setOpen] = useState(false);

  const models = modelsQ.data;
  const emb = embQ.data;
  const selected = models?.selected;
  const name = selected ? shortName(selected) : lastModel ? shortName(lastModel) : 'Auto';
  const embLabel = emb?.providers.find((p) => p.id === emb.selected)?.label;

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="coder-picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent' }}
        title="Chat model and embedding model"
      >
        <span style={{ color: '#DFF5EB', fontWeight: 500 }}>{name}</span>
        {embLabel && <span className="coder-picker-sub">{embLabel}</span>}
        {(busy || (emb?.adding_vectors.length ?? 0) > 0) && (
          <Loader2 size={14} className="coder-spin" style={{ color: 'var(--text-muted)' }} />
        )}
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="coder-menu" role="listbox" style={{ bottom: 'calc(100% + 8px)', right: 0, width: 320, maxHeight: 340, overflowY: 'auto', zIndex: 50, background: 'rgba(22,22,26,.98)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: 6 }}>
            <p className="coder-menu-meta" style={{ padding: '6px 10px' }}>EMBEDDINGS (search)</p>
            {emb?.providers.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={emb.selected === p.id}
                className="coder-menu-item"
                style={{ background: 'transparent', opacity: p.available ? 1 : 0.5 }}
                onClick={() => selectEmb.mutate(p.id)}
              >
                <span style={{ flex: 1 }}>
                  {p.label} <span className="coder-menu-meta">{p.model.split('/').pop()}{p.available ? '' : ' · no API key'}</span>
                </span>
                {emb.selected === p.id && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
            {emb && emb.adding_vectors.length > 0 && (
              <p className="coder-menu-meta" style={{ padding: '4px 10px' }}>
                Embedding {emb.adding_vectors.length} repo(s); keyword search until done.
              </p>
            )}

            <p className="coder-menu-meta" style={{ padding: '10px 10px 6px' }}>CHAT MODEL</p>
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              className="coder-menu-item"
              style={{ background: 'transparent' }}
              onClick={() => { selectModel.mutate(null); setOpen(false); }}
            >
              <span style={{ flex: 1 }}>Auto <span className="coder-menu-meta">best model per task</span></span>
              {!selected && <Check size={14} style={{ color: 'var(--accent)' }} />}
            </button>
            {models?.models.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={selected === m.id}
                className="coder-menu-item"
                style={{ background: 'transparent', opacity: m.state === 'available' ? 1 : 0.5 }}
                onClick={() => { selectModel.mutate(m.id); setOpen(false); }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shortName(m.id)} <span className="coder-menu-meta">{m.provider}</span>
                </span>
                {selected === m.id && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
