import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import AppBackground from './AppBackground';
import { RepoProvider } from '../../context/RepoContext';
import { ErrorBanner } from '../../components/shared/States';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export default function Shell({ children }: { children?: React.ReactNode }) {
  const health = useQuery({ queryKey: ['llm-status'], queryFn: () => apiFetch('/api/llm/status'), retry: 1 });
  const showBanner = !USE_MOCK && health.isError;

  return (
    <RepoProvider>
      <div className="app-shell" style={{ display: 'flex', height: '100vh', position: 'relative', overflow: 'hidden' }}>
        {/* Living sunset background — mounted once, z-index 0 */}
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
              <ErrorBanner message="Backend unreachable" onRetry={() => health.refetch()} />
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
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
              {children ?? <Outlet />}
            </div>
          </main>
        </div>
      </div>
    </RepoProvider>
  );
}
