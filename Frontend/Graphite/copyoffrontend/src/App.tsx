import { Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import Shell from './components/layout/Shell';
import LandingPage from './pages/LandingPage';
import PageLoader from './components/transition/PageLoader';
import { LaunchProvider } from './context/LaunchContext';
import ReposPage from './pages/ReposPage';
import ExplorerPage from './pages/ExplorerPage';
import AskPage from './pages/AskPage';
import PRReviewPage from './pages/PRReviewPage';
import RepairPage from './pages/RepairPage';
import SystemStatusPage from './pages/SystemStatusPage';
import NotFoundPage from './pages/NotFoundPage';

const ROUTES = ['/repos', '/explorer', '/ask', '/pr-review', '/repair', '/status'];

export default function App() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 6) {
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
          <Route path="/ask" element={<AskPage />} />
          <Route path="/pr-review" element={<PRReviewPage />} />
          <Route path="/repair" element={<RepairPage />} />
          <Route path="/status" element={<SystemStatusPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </LaunchProvider>
  );
}