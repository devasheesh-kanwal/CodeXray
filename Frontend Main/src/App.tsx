import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import Shell from './components/layout/Shell';
import LandingPage from './pages/LandingPage';
import PageLoader from './components/transition/PageLoader';
import { LaunchProvider } from './context/LaunchContext';
import ReposPage from './pages/ReposPage';
import ExplorerPage from './pages/ExplorerPage';
import CoderPage from './pages/CoderPage';
import PRReviewPage from './pages/PRReviewPage';
import SystemStatusPage from './pages/SystemStatusPage';
import NotFoundPage from './pages/NotFoundPage';

const ROUTES = ['/repos', '/explorer', '/coder', '/pr-review', '/status'];

export default function App() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= ROUTES.length) {
        navigate(ROUTES[n - 1]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return (
    <LaunchProvider>
      <PageLoader />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<Shell />}>
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/coder" element={<CoderPage />} />
          {/* Ask and Repair are now one page */}
          <Route path="/ask" element={<Navigate to="/coder" replace />} />
          <Route path="/repair" element={<Navigate to="/coder" replace />} />
          <Route path="/pr-review" element={<PRReviewPage />} />
          <Route path="/status" element={<SystemStatusPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </LaunchProvider>
  );
}