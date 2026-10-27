import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useLaunchApp } from '../../context/LaunchContext';
import { scrollToSection } from '../../lib/scrollToSection';

const links = [
  { href: '#home', id: 'home', label: 'HOME' },
  { href: '#features', id: 'features', label: 'FEATURES' },
  { href: '#how-it-works', id: 'how-it-works', label: 'HOW IT WORKS' },
  { href: '#about', id: 'about', label: 'ABOUT' },
];

export default function Nav() {
  const { isLaunching, launch } = useLaunchApp();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('home');
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    function onScroll() {
      setSolid(window.scrollY > window.innerHeight * 0.85);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
    );
    links.forEach((l) => {
      const el = document.getElementById(l.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  function handleLink(id: string) {
    setOpen(false);
    scrollToSection(id);
  }

  return (
    <nav className={`w-full sticky top-0 z-40 border-b transition-colors ${solid ? 'bg-bg-deep/90 backdrop-blur border-[rgba(207,241,230,0.18)]' : 'bg-transparent border-[rgba(207,241,230,0.18)]'}`}>
      <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between">
        <a
          href="#home"
          onClick={(e) => { e.preventDefault(); handleLink('home'); }}
          className="font-display text-xl tracking-wide text-landing-mint"
        >
          CodeXray
        </a>
        <ul className="hidden md:flex items-center gap-8 font-landing tracking-[0.2em] text-landing-mint/80 text-[clamp(12px,0.85vw,14px)]">
          {links.map((l) => (
            <li key={l.id}>
              <a
                href={l.href}
                onClick={(e) => { e.preventDefault(); handleLink(l.id); }}
                className={`hover:text-hero-mint transition-colors ${active === l.id ? 'text-hero-mint border-b-2 border-hero-red' : 'text-landing-mint/80'}`}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <button
            onClick={launch}
            disabled={isLaunching}
            className="hidden sm:inline-flex px-4 py-1.5 rounded-full border border-landing-mint/40 text-landing-mint font-landing text-xs tracking-[0.22em] hover:border-landing-red hover:text-landing-red transition-colors disabled:opacity-50"
          >
            GET STARTED
          </button>
          <a href="https://github.com" aria-label="GitHub" className="text-landing-mint/80 hover:text-landing-red transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.0 11.0 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.15 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/></svg>
          </a>
          <button className="md:hidden text-landing-mint" aria-label="Menu" onClick={() => setOpen((v) => !v)}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="md:hidden border-t border-landing-mint/10 bg-landing-bg">
          <ul className="flex flex-col px-6 py-4 gap-4 font-landing tracking-[0.2em] text-landing-mint/80 text-[clamp(12px,0.85vw,14px)]">
            <li><button onClick={() => { setOpen(false); launch(); }} disabled={isLaunching} className="hover:text-landing-red disabled:opacity-50">GET STARTED</button></li>
            {links.map((l) => (
              <li key={l.id}>
                <a
                  href={l.href}
                  onClick={(e) => { e.preventDefault(); handleLink(l.id); }}
                  className={`hover:text-hero-mint ${active === l.id ? 'text-hero-mint border-b-2 border-hero-red' : 'text-landing-mint/80'}`}
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}