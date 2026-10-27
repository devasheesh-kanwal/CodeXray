import { MessageSquare, FolderTree, GitPullRequest, Wrench } from 'lucide-react';

const features = [
  { icon: MessageSquare, title: 'Ask', text: 'Chat with any repo and get answers with exact line citations.' },
  { icon: FolderTree, title: 'Explorer', text: 'Navigate files, imports and calls as an interactive graph.' },
  { icon: GitPullRequest, title: 'PR Review', text: 'Catch bugs, security issues and design breaks before they merge.' },
  { icon: Wrench, title: 'Repair', text: 'Agents fix and test on a safe branch. You approve the merge.' },
];

export default function Features() {
  return (
    <section tabIndex={-1} id="features" className="bg-landing-bg py-24 landing-section">
      <div className="max-w-[1440px] mx-auto px-6">
        <h2 className="font-display text-4xl text-landing-mint mb-12" data-aos="fade-up">Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <div
              key={f.title}
              data-aos="fade-up"
              data-aos-delay={i * 100}
              className="bg-landing-surface border border-landing-mint/10 rounded-2xl p-6 hover:border-landing-red/40 transition-colors"
            >
              <f.icon size={28} className="text-landing-red mb-4" />
              <h3 className="font-landing text-lg tracking-wide text-landing-mint mb-2">{f.title}</h3>
              <p className="font-landing text-sm text-landing-muted leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}