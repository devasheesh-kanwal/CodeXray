import { useEffect, useRef, useState } from 'react';
import { useLaunchApp, LOADER_DURATION_MS } from '../../context/LaunchContext';
import Logo from '../ui/Logo';

const STATUSES = ['Indexing files...', 'Mapping dependencies...', 'Reading symbols...', 'Ready.'];

export default function PageLoader() {
  const { isLaunching } = useLaunchApp();
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [reduce, setReduce] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
  }, []);

  useEffect(() => {
    if (!isLaunching) {
      setProgress(0);
      setStatusIndex(0);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    if (reduce) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const p = Math.min(100, (elapsed / LOADER_DURATION_MS) * 100);
      setProgress(p);
      const si = Math.min(STATUSES.length - 1, Math.floor(elapsed / 600));
      setStatusIndex(si);
      if (p < 100) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isLaunching, reduce]);

  useEffect(() => {
    if (!isLaunching) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isLaunching]);

  if (!isLaunching) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black"
      style={{ animation: reduce ? 'fadeIn 0.2s ease-out' : 'fadeIn 0.3s ease-out' }}
    >
      {/* blurred code lines */}
      <div aria-hidden className="absolute inset-0 overflow-hidden opacity-20 pointer-events-none">
        <pre className="font-mono text-xs text-landing-mint leading-6 blur-sm select-none">
{`import { x } from './core';
function scan(node) { return node.map(v => v.id); }
const graph = buildIndex(repo);
export async function ask(q) { return retrieve(q); }
// x-ray pass
`}
        </pre>
      </div>

      {/* scan line */}
      {!reduce && (
        <div
          aria-hidden
          className="absolute left-0 right-0 h-px bg-landing-red shadow-[0_0_12px_2px_rgba(194,28,29,0.8)]"
          style={{ animation: `scanLine ${LOADER_DURATION_MS}ms linear infinite` }}
        />
      )}

      <div className="relative z-10 flex flex-col items-center gap-6">
        <Logo size="lg" as="h1" />
        {reduce ? (
          <p className="font-landing text-xs tracking-[0.22em] text-landing-mint/70">LOADING...</p>
        ) : (
          <>
            <div className="w-64 h-1 bg-landing-mint/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-landing-red origin-left"
                style={{ transform: `scaleX(${progress / 100})` }}
              />
            </div>
            <div className="font-landing text-4xl tracking-[0.18em] text-landing-mint tabular-nums">
              {String(Math.round(progress)).padStart(2, '0')}
            </div>
            <p className="font-landing text-xs tracking-[0.22em] text-landing-mint/70">
              {STATUSES[statusIndex].toUpperCase()}
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scanLine {
          0% { top: 0%; }
          100% { top: 100%; }
        }
      `}</style>
    </div>
  );
}