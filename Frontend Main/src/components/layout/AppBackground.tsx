import { VIEWBOX, ASPECT, WEBS, STRANDS } from './spiderWeb';

/**
 * AppBackground
 * Fixed, full-viewport background for the app shell (not the landing page or the loader).
 * Layers (bottom → top):
 *  1. Graphite base with a soft light from the top
 *  2. Spider webs (SVG, see spiderWeb.ts)
 *  3. Vignette
 *  4. Film grain
 */
export default function AppBackground({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transition: 'opacity 700ms ease',
      }}
    >
      {/* ── Layer 1: Base ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(ellipse 70% 55% at 58% 0%, rgba(255,255,255,.07), transparent 70%),
            radial-gradient(ellipse 60% 40% at 50% 100%, rgba(179,38,30,.08), transparent 70%),
            #0E0E10
          `,
        }}
      />

      {/* ── Layer 2: Webs ── */}
      <svg
        viewBox={VIEWBOX}
        preserveAspectRatio={ASPECT}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <defs>
          <radialGradient id="web-fade-0" cx="1420" cy="200" r="560" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#E8E8EC" stopOpacity="1" />
            <stop offset="1" stopColor="#E8E8EC" stopOpacity="0.25" />
          </radialGradient>
        </defs>
        <g fill="none" stroke="#E2E2E6" strokeLinecap="round">
          {WEBS.map((w, i) => (
            <g key={i} opacity={w.opacity} stroke={i === 0 ? 'url(#web-fade-0)' : undefined}>
              <path d={w.spokes} strokeWidth={1} />
              <path d={w.rings} strokeWidth={0.8} />
            </g>
          ))}
          <g opacity={0.12} strokeWidth={0.8}>
            {STRANDS.map((d) => <path key={d} d={d} />)}
          </g>
        </g>
      </svg>

      {/* ── Layer 3: Vignette ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(0,0,0,.55) 100%)',
        }}
      />

      {/* ── Layer 4: Film grain ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.05,
          mixBlendMode: 'overlay',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px 200px',
        }}
      />
    </div>
  );
}
