import { useEffect, useState } from 'react';
import Nav from '../components/landing/Nav';
import Hero from '../components/landing/Hero';
import Features from '../components/landing/Features';
import HowItWorks from '../components/landing/HowItWorks';
import About from '../components/landing/About';
import Footer from '../components/landing/Footer';
import { initAOS, refreshAOS } from '../lib/aos';
import { scrollToSection } from '../lib/scrollToSection';
import { LOADER_DURATION_MS } from '../context/LaunchContext';

export default function LandingPage() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    initAOS(reduce);
    const refresh = () => refreshAOS();
    if (document.readyState === 'complete') refresh();
    else window.addEventListener('load', refresh);
    const t = window.setTimeout(refresh, 300);
    const t2 = window.setTimeout(refresh, LOADER_DURATION_MS + 500);
    // handle direct hash
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      window.setTimeout(() => scrollToSection(hash), 100);
    }
    return () => {
      window.removeEventListener('load', refresh);
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, []);

  // refresh after loader transition? handled by timeout above
  return (
    <div className="bg-landing-bg text-landing-mint min-h-screen landing-section">
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <About />
        <Footer />
      </main>
      {/* back to top */}
      <BackToTop />
    </div>
  );
}

function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > window.innerHeight);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => scrollToSection('home')}
      aria-label="Back to top"
      className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-landing-surface border border-landing-mint/20 text-landing-mint flex items-center justify-center hover:border-landing-red hover:text-landing-red transition-colors shadow-lg"
    >
      ↑
    </button>
  );
}