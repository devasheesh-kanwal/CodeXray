import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 className="text-h1 mb-2">404</h1>
      <p className="text-body-sm text-text-secondary mb-6">Page not found.</p>
      <button onClick={() => navigate('/repos')} className="px-4 py-2 rounded-lg bg-accent text-white text-body-sm font-medium hover:bg-accent-hover">
        Go to Repos
      </button>
    </div>
  );
}