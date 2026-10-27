import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { RepoProvider } from '../../context/RepoContext';
import { ErrorBanner } from '../../components/shared/States';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export default function Shell({ children }: { children?: React.ReactNode }) {
  const health = useQuery({ queryKey: ['llm-status'], queryFn: () => apiFetch('/api/llm/status'), retry: 1 });
  const showBanner = !USE_MOCK && health.isError;
  return (
    <RepoProvider>
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          {showBanner && <div className="p-4"><ErrorBanner message="Backend unreachable" onRetry={() => health.refetch()} /></div>}
          <main className="flex-1 overflow-auto p-8">
            <div className="max-w-content mx-auto">{children ?? <Outlet />}</div>
          </main>
        </div>
      </div>
    </RepoProvider>
  );
}
