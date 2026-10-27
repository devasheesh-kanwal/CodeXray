import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import type { Health } from '../../api/types';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { RepoProvider } from '../../context/RepoContext';
import { ApiErrorView } from '../../components/shared/States';

export default function Shell({ children }: { children?: React.ReactNode }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => apiFetch<Health>('/api/health'), retry: 1, refetchInterval: 15000 });
  const showBanner = health.isError;
  return (
    <RepoProvider>
      <div className="app-shell flex h-screen" style={{ background: '#101113' }}>
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          {showBanner && <div className="p-4"><ApiErrorView error={health.error} onRetry={() => health.refetch()} /></div>}
          <main className="flex-1 overflow-auto p-8" style={{ background: '#101113' }}>
            <div className="max-w-content mx-auto">{children ?? <Outlet />}</div>
          </main>
        </div>
      </div>
    </RepoProvider>
  );
}
