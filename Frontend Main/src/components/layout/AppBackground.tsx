import { useEffect, useRef, useState } from 'react';
import heroImg from '../../assets/hero.png';

/**
 * AppBackground
 * Fixed, full-viewport living sunset background for the app shell.
 * Layers (bottom → top):
 *  1. Base fill (#0B0B0E)
 *  2. Hero photo (blurred, masked) — desktop only
 *  3. Sunset mesh orbs (animated, mouse-parallax)
 *  4. Sun-ray sweep diagonal band
 *  5. Vignette + bottom fade
 *  6. Film grain (SVG feTurbulence)
 */
export default function AppBackground({ visible }: { visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion.current) return;

    // rAF-throttled mouse parallax
    let pending = false;
    function onMove(e: MouseEvent) {
      if (pending) return;
      pending = true;
      rafRef.current = requestAnimationFrame(() => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const dx = (e.clientX - cx) / cx; // -1..1
        const dy = (e.clientY - cy) / cy;
        setMouse({ x: dx * 14, y: dy * 14 });
        pending = false;
      });
    }

    // Only enable parallax on non-touch devices
    if (!('ontouchstart' in window)) {
      window.addEventListener('mousemove', onMove, { passive: true });
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const rm = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // ── Orb definitions ──────────────────────────────────────────
  const orbs = [
    // { color, opacity, size (vmax), left%, top%, animation, parallaxFactor }
    { color: '#D9A066', opacity: 0.30, size: 48, left: '70%',  top: '-15%', anim: 'orbDrift1 36s ease-in-out infinite alternate', pf: 1.0  },
    { color: '#C98B6B', opacity: 0.20, size: 36, left: '30%',  top: '5%',   anim: 'orbDrift2 28s ease-in-out infinite alternate', pf: 0.6  },
    { color: '#B5574A', opacity: 0.24, size: 44, left: '-12%', top: '38%',  anim: 'orbDrift3 42s ease-in-out infinite alternate', pf: 0.8  },
    { color: '#46598F', opacity: 0.34, size: 52, left: '-10%', top: '72%',  anim: 'orbDrift4 48s ease-in-out infinite alternate', pf: 1.2  },
    { color: '#B3261E', opacity: 0.26, size: 40, left: '68%',  top: '68%',  anim: 'orbDrift5 32s ease-in-out infinite alternate', pf: 0.9  },
    { color: '#2B3466', opacity: 0.30, size: 30, left: '40%',  top: '78%',  anim: 'orbDrift6 26s ease-in-out infinite alternate', pf: 0.5  },
  ];

  // On mobile: show only first 3 orbs
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transition: 'opacity 700ms ease',
        animation: visible ? undefined : undefined,
      }}
    >
      {/* ── Layer 1: Base fill ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#0B0B0E',
        }}
      />

      {/* ── Layer 2: Hero photo — desktop only ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${heroImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 20%',
          filter: 'blur(70px) saturate(1.2)',
          opacity: 0.35,
          maskImage: 'linear-gradient(to bottom, #000 0%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, transparent 85%)',
          display: isMobile ? 'none' : 'block',
        }}
      />

      {/* ── Layer 3: Sunset mesh orbs ── */}
      {(isMobile ? orbs.slice(0, 3) : orbs).map((orb, i) => (
        <div
          key={i}
          className="orb"
          style={{
            position: 'absolute',
            left: orb.left,
            top: orb.top,
            width: `${orb.size}vmax`,
            height: `${orb.size}vmax`,
            borderRadius: '50%',
            background: orb.color,
            opacity: orb.opacity,
            filter: `blur(${i < 2 ? 110 : i < 4 ? 130 : 140}px)`,
            willChange: 'transform',
            animation: rm ? 'none' : orb.anim,
            transform: rm
              ? undefined
              : `translate(${mouse.x * orb.pf}px, ${mouse.y * orb.pf}px)`,
            transition: rm ? 'none' : 'transform 0.15s linear',
          }}
        />
      ))}

      {/* ── Layer 4: Sun-ray sweep ── */}
      {!isMobile && !rm && (
        <div
          className="sun-ray"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(115deg, transparent 35%, rgba(217,160,102,.10) 50%, transparent 65%)',
            filter: 'blur(30px)',
            animation: 'sunRaySweep 40s ease-in-out infinite alternate',
          }}
        />
      )}

      {/* ── Layer 5: Vignette + bottom fade ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(ellipse at 50% 40%, transparent 45%, rgba(0,0,0,.55) 100%),
            linear-gradient(to bottom, transparent 75%, #0B0B0E 100%)
          `,
        }}
      />

      {/* ── Layer 6: Film grain ── */}
      {!isMobile && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.04,
            mixBlendMode: 'overlay',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '200px 200px',
          }}
        />
      )}
    </div>
  );
}
