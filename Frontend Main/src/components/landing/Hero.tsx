import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLaunchApp } from '../../context/LaunchContext';

const slides = [
  { red: 'ASK', mint: 'YOUR CODEBASE', text: 'Chat with any repo and get answers with exact line citations.' },
  { red: 'REVIEW', mint: 'WITH CONFIDENCE', text: 'Catch bugs, security issues and design breaks before they merge.' },
  { red: 'REPAIR', mint: 'WITH A HUMAN IN CHARGE', text: 'Agents fix and test on a safe branch. You approve the merge.' },
];

export default function Hero() {
  const { isLaunching, launch } = useLaunchApp();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduce, setReduce] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const handler = () => setReduce(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (paused || reduce) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), 6000);
    return () => window.clearInterval(t);
  }, [paused, reduce]);

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduce) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setParallax({ x: x * 8, y: y * 8 });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % slides.length);
    if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + slides.length) % slides.length);
  }

  const slide = slides[index];

  return (
    <section
      id="home"
      tabIndex={-1}
      ref={containerRef}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => { setPaused(false); setParallax({ x: 0, y: 0 }); }}
      className="relative overflow-hidden w-full h-[100svh] min-h-[600px] -mt-16 pt-16"
      style={{ background: 'var(--bg-deep)' }}
    >
      {/* top scrim behind nav */}
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 pointer-events-none z-20"
        style={{ height: '140px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)' }}
      />

      {/* Layer 1: base dark vignette — neutral black */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 80% at 75% 40%, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.45) 55%, #000000 100%)',
        }}
      />

      {/* Layer 2: Spider-Man video — full width */}
      <video
        aria-hidden
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 pointer-events-none object-cover object-[50%_30%]"
        style={{
          width: '100%',
          height: '100%',
          maskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)',
          transform: reduce ? 'none' : `translate(${parallax.x * 0.3}px, ${parallax.y * 0.3}px)`,
          transition: reduce ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        <source src="/assets/spiderman.mp4" type="video/mp4" />
      </video>

      {/* Layer 3: bottom fade into pure black */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: '28%',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,.55) 55%, #000000 100%)',
        }}
      />

      {/* Layer 4: dark radial text scrim — neutral black, no green tint */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 55% 40% at 50% 72%, rgba(0,0,0,.65) 0%, rgba(0,0,0,.35) 55%, transparent 80%)',
          zIndex: 5,
        }}
      />

      {/* content — lower third of the hero */}
      <div className="relative w-full h-full flex flex-col items-center justify-end pb-[14vh] text-center" style={{ zIndex: 10 }}>
        {/* text column */}
        <div className="px-6 max-w-[680px] w-full mx-auto" onKeyDown={onKeyDown} tabIndex={0} role="region" aria-roledescription="carousel" aria-label="Hero slides">

          {/* label */}
          <div className="font-landing uppercase text-[0.75rem] tracking-[0.3em] text-[rgba(207,241,230,0.70)] mb-4">
            SAME CODE<br />NEW PERSPECTIVES
          </div>

          {/* animated headline + mint line */}
          <div key={index} style={{ animation: reduce ? 'none' : 'heroSlideIn 0.5s ease-out both' }}>
            <h1
              className="font-display font-black uppercase text-hero-red leading-[.9] tracking-[-0.01em] whitespace-nowrap"
              style={{
                fontSize: 'clamp(3rem, min(7vw, 13vh), 7.5rem)',
                textShadow: '0 2px 24px rgba(0,0,0,.45)',
              }}
            >
              {slide.red}
            </h1>
            <p
              className="font-display font-normal uppercase text-hero-mint tracking-[.02em] leading-[1.05] mt-3 mx-auto"
              style={{
                fontSize: 'clamp(1.25rem, min(2.95vw, 5.5vh), 3.15rem)',
                maxWidth: '60vw',
                textWrap: 'balance',
              } as React.CSSProperties}
            >
              {slide.mint}
            </p>
          </div>

          {/* divider */}
          <div className="h-px bg-[rgba(207,241,230,0.45)] my-5 mx-auto" style={{ width: '3vw', minWidth: '32px' }} />

          {/* body text */}
          <p
            className="font-landing leading-[1.6] text-[rgba(207,241,230,0.85)] mx-auto"
            style={{ fontSize: 'clamp(.95rem, 1.05vw, 1.1rem)', maxWidth: '44ch' }}
          >
            {slide.text}
          </p>

          {/* CTA button */}
          <button
            onClick={launch}
            disabled={isLaunching}
            className="group mt-6 inline-flex items-center gap-2.5 px-5 py-[11px] rounded-full border border-[rgba(207,241,230,0.4)] text-hero-mint font-landing tracking-[0.22em] hover:border-hero-red hover:text-hero-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-red disabled:opacity-50"
            style={{ fontSize: '12px' }}
          >
            GET STARTED
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      </div>


      <style>{`
        @keyframes heroSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}