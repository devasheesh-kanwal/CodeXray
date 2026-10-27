const steps = ['Branch', 'Fix', 'Test', 'Eval gate', 'Human approval'];

export default function HowItWorks() {
  return (
    <section tabIndex={-1} id="how-it-works" className="bg-landing-bg py-24 border-t border-landing-mint/10 landing-section">
      <div className="max-w-[1440px] mx-auto px-6">
        <h2 className="font-display text-4xl text-landing-mint mb-12" data-aos="fade-up">How it works</h2>
        <div className="flex flex-col md:flex-row items-center gap-4 md:gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2 md:gap-4 flex-1" data-aos={i % 2 === 0 ? 'fade-up' : 'fade-up'} data-aos-delay={i * 100}>
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full border-2 border-landing-red text-landing-red flex items-center justify-center font-landing text-sm font-semibold">
                  {i + 1}
                </div>
                <span className="mt-3 font-landing text-xs tracking-[0.18em] text-landing-mint text-center">{s.toUpperCase()}</span>
              </div>
              {i < steps.length - 1 && (
                <div className="hidden md:block flex-1 h-px bg-landing-mint/20" data-aos="zoom-in" data-aos-delay={i * 100 + 50} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}