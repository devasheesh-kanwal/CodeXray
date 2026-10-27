export default function About() {
  const stats = [
    { value: 'Line-level', label: 'Citations' },
    { value: 'Safe', label: 'Branches' },
    { value: 'Human', label: 'Approval' },
  ];
  return (
    <section tabIndex={-1} id="about" className="bg-landing-bg py-24 border-t border-landing-mint/10 landing-section">
      <div className="max-w-[1440px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div data-aos="fade-right">
          <h2 className="font-display text-4xl text-landing-mint mb-6">About CodeXray</h2>
          <p className="font-landing text-base text-landing-mint/80 leading-relaxed mb-4">
            CodeXray indexes your repository and turns it into something you can talk to. Ask questions and get answers with exact line citations, review changes before they merge, and let agents propose fixes on safe branches.
          </p>
          <p className="font-landing text-base text-landing-mint/80 leading-relaxed">
            Every change stays under your control: tests run on an isolated branch and a human approves the merge.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              data-aos="zoom-in"
              data-aos-delay={i * 100}
              className="bg-landing-surface border border-landing-mint/10 rounded-2xl p-6 text-center"
            >
              <div className="font-display text-2xl text-landing-red mb-2">{s.value}</div>
              <div className="font-landing text-xs tracking-[0.18em] text-landing-mint/70">{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}