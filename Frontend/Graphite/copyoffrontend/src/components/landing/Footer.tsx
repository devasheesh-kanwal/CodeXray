import { useLaunchApp } from '../../context/LaunchContext';

export default function Footer() {
  const { isLaunching, launch } = useLaunchApp();
  return (
    <footer id="about" className="bg-landing-bg border-t border-landing-mint/10">
      <div className="max-w-[1440px] mx-auto px-6 py-20 text-center" data-aos="zoom-in">
        <h2 className="font-display text-5xl text-landing-mint mb-6">Ready to see your code differently?</h2>
        <button
          onClick={launch}
          disabled={isLaunching}
          className="inline-flex items-center gap-3 px-8 py-3 rounded-full border border-landing-mint/40 text-landing-mint font-landing text-xs tracking-[0.22em] hover:border-landing-red hover:text-landing-red transition-colors disabled:opacity-50"
        >
          GET STARTED
        </button>
      </div>
      <div className="border-t border-landing-mint/10 py-6 text-center font-landing text-xs tracking-[0.18em] text-landing-muted" data-aos="fade-up">
        © 2026 CodeXray
      </div>
    </footer>
  );
}