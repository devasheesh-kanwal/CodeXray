import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import type { Health } from '../../api/types';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import AppBackground, { WebOverlay } from './AppBackground';
import { RepoProvider } from '../../context/RepoContext';
import { ApiErrorView } from '../../components/shared/States';

export default function Shell({ children }: { children?: React.ReactNode }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => apiFetch<Health>('/api/health'), retry: 1, refetchInterval: 15000 });
  const showBanner = health.isError;
  const { pathname } = useLocation();

  return (
    <RepoProvider>
      <div className="app-shell" style={{ display: 'flex', height: '100vh', position: 'relative', overflow: 'hidden' }}>
        {/* Spider-web background — mounted once, z-index 0 */}
        <AppBackground visible={true} />

        {/* Sidebar — z-index 10 above background */}
        <div style={{ position: 'relative', zIndex: 10, flexShrink: 0 }}>
          <Sidebar />
        </div>

        {/* Main column */}
        <div style={{ position: 'relative', zIndex: 10, flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Topbar />
          {showBanner && (
            <div style={{ padding: '12px 24px' }}>
              <ApiErrorView error={health.error} onRetry={() => health.refetch()} />
            </div>
          )}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '32px',
            }}
          >
            {/* keyed by route so the page-enter motion replays on every navigation */}
            <div key={pathname} style={{ maxWidth: 1280, margin: '0 auto' }}>
              {children ?? <Outlet />}
            </div>
          </main>
        </div>

        {/* the web again, faintly, on top of the cards and buttons (ignores clicks) */}
        <WebOverlay />
      </div>
    </RepoProvider>
  );
}
