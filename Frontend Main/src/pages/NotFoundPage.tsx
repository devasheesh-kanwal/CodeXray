import { useNavigate } from 'react-router-dom';
import Logo from '../components/ui/Logo';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="mb-6">
        <Logo size="lg" href="/" />
      </div>
      <h1
        className="page-title mb-2 text-text font-extrabold"
        style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', letterSpacing: '-0.02em' }}
      >
        <span className="page-title-accent">404</span>
      </h1>
      <p className="text-sm text-text-muted mb-6 font-sans">Page not found.</p>
      <button
        type="button"
        onClick={() => navigate('/repos')}
        className="px-6 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] font-sans font-semibold tracking-wider uppercase inline-flex items-center gap-2 transition-colors cursor-pointer"
      >
        Go to Repos
      </button>
    </div>
  );
}