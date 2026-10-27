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
        style={{ height: '140px', background: 'linear-gradient(to bottom, rgba(5,12,9,0.65), transparent)' }}
      />

      {/* Layer 1: base gradient */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 80% at 75% 40%, var(--bg-teal) 0%, #08140F 55%, var(--bg-deep) 100%)',
        }}
      />

      {/* Layer 2: Spider-Man image (width matches rendered image) */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 pointer-events-none"
        style={{
          width: '55vw',
          backgroundImage: "url('/assets/spiderman.webp')",
          backgroundSize: 'cover',
          backgroundPosition: '25% 30%',
          backgroundRepeat: 'no-repeat',
          maskImage: 'linear-gradient(to right, #000 0%, #000 55%, transparent 100%), linear-gradient(to bottom, #000 72%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, #000 0%, #000 55%, transparent 100%), linear-gradient(to bottom, #000 72%, transparent 100%)',
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
          transform: reduce ? 'none' : `translate(${parallax.x * 0.3}px, ${parallax.y * 0.3}px)`,
          transition: reduce ? 'none' : 'transform 0.3s ease-out',
        }}
      />

      {/* Layer 3: red light beam (slim, tilted, behind subject) */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          left: '46%',
          top: '10%',
          width: '9vw',
          height: '72%',
          background: 'linear-gradient(to bottom, rgba(229,22,27,0.8) 0%, #C9131A 45%, rgba(110,10,14,0.7) 75%, transparent 85%)',
          clipPath: 'polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%)',
          filter: 'blur(8px) drop-shadow(0 0 40px rgba(229,22,27,0.25))',
          maskImage: 'linear-gradient(to right, transparent 0%, #000 22%, #000 78%, transparent 100%), linear-gradient(to bottom, transparent 0%, #000 10%, #000 75%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, #000 22%, #000 78%, transparent 100%), linear-gradient(to bottom, transparent 0%, #000 10%, #000 75%, transparent 85%)',
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
          mixBlendMode: 'screen',
          opacity: 0.7,
          transform: reduce ? 'none' : `translate(${parallax.x * 0.5}px, ${parallax.y * 0.5}px)`,
        }}
      />

      {/* Layer 4: glossy red floor reflection (radial only) */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{ height: '20%' }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 55% 45% at 30% 100%, rgba(225,25,30,0.40) 0%, rgba(225,25,30,0.14) 55%, transparent 80%)',
            maskImage: 'linear-gradient(to top, #000 0%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to top, #000 0%, transparent 100%)',
          }}
        />
      </div>

      {/* Layer 5: bottom fade into bg-deep */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: '12%',
          background: 'linear-gradient(to bottom, transparent 0%, var(--bg-deep) 100%)',
        }}
      />

      {/* content */}
      <div className="relative z-10 w-full h-full flex flex-col justify-center">
        {/* counter far right */}
        <button
          onClick={() => setIndex((i) => (i + 1) % slides.length)}
          onKeyDown={onKeyDown}
          className="absolute right-[5vw] top-[26%] hidden lg:flex flex-col items-center gap-2 font-landing text-xs tracking-[0.2em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-red rounded"
          aria-label="Next slide"
        >
          <span className="text-hero-mint">{String(index + 1).padStart(2, '0')}</span>
          <span className="w-px h-6 bg-hero-mint/40" />
          <span className="text-hero-mint/40">03</span>
        </button>

        {/* text column */}
        <div className="lg:ml-[52%] lg:mr-[6%] px-6 lg:px-0" onKeyDown={onKeyDown} tabIndex={0} role="region" aria-roledescription="carousel" aria-label="Hero slides">
          <div className="font-landing uppercase tracking-[0.3em] text-[clamp(12px,0.9vw,14px)] text-[rgba(207,241,230,0.75)] mb-6">
            SAME CODE<br />NEW PERSPECTIVES
          </div>
          <div key={index} style={{ animation: reduce ? 'none' : 'heroSlideIn 0.6s ease-out both' }}>
            <h1 className="font-display font-black uppercase text-hero-red leading-[0.85] tracking-[-0.01em] text-[clamp(4.5rem,min(12vw,22vh),15rem)] whitespace-nowrap">
              {slide.red}
            </h1>
            <p className="font-display font-normal uppercase text-hero-mint tracking-[0.01em] leading-[0.95] text-[clamp(1.89rem,min(5.04vw,9.24vh),6.3rem)] mt-2" style={{ textWrap: 'balance' } as React.CSSProperties}>
              {slide.mint}
            </p>
          </div>
          <div className="h-px w-[4vw] min-w-[40px] bg-[rgba(207,241,230,0.5)] my-6" />
          <p className="font-landing text-[clamp(15px,1.15vw,18px)] leading-[1.6] text-[rgba(207,241,230,0.85)] max-w-[26vw]">
            {slide.text}
          </p>
          <button
            onClick={launch}
            disabled={isLaunching}
            className="group mt-8 inline-flex items-center gap-3 self-start px-6 py-3 rounded-full border border-[rgba(207,241,230,0.4)] text-hero-mint font-landing text-xs tracking-[0.22em] hover:border-hero-red hover:text-hero-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-red disabled:opacity-50"
          >
            GET STARTED
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      </div>

      {/* thumbnail card bottom right */}
      <div className="absolute bottom-6 right-6 w-36 h-24 rounded-2xl overflow-hidden border border-[rgba(207,241,230,0.2)] shadow-lg z-20">
        <img src="/assets/spiderman-thumb.webp" alt="Detail" className="w-full h-full object-cover" />
      </div>

      <style>{`
        @keyframes heroSlideIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}