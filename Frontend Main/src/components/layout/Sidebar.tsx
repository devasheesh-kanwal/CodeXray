import { NavLink } from 'react-router-dom';
import { Database, FolderTree, MessageSquare, GitPullRequest, Wrench, Activity } from 'lucide-react';
import Logo from '../ui/Logo';
import { USE_MOCK } from '../../api/client';

const items = [
  { to: '/repos',    label: 'Repos',         icon: Database },
  { to: '/explorer', label: 'Explorer',       icon: FolderTree },
  { to: '/ask',      label: 'Ask',            icon: MessageSquare },
  { to: '/pr-review',label: 'PR Review',      icon: GitPullRequest },
  { to: '/repair',   label: 'Repair',         icon: Wrench },
  { to: '/status',   label: 'System Status',  icon: Activity },
];

export default function Sidebar() {
  return (
    <aside
      className="w-sidebar h-screen flex flex-col shrink-0"
      style={{
        background: 'linear-gradient(180deg, #1A1B1E 0%, #17181B 100%)',
        borderRight: '1px solid rgba(255,255,255,.08)',
      }}
    >
      {/* Logo */}
      <div
        className="h-[72px] flex items-center px-6 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}
      >
        <Logo size="md" href="/" />
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-auto">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13px] font-sans font-medium transition-all duration-200 group ${
                isActive
                  ? 'text-[#DFF5EB]'
                  : 'text-[#8FA8A0] hover:text-[#DFF5EB]'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? {
                    background: 'rgba(220,31,31,.14)',
                    borderLeft: '2px solid #DC1F1F',
                    paddingLeft: '10px',
                    boxShadow: '0 0 18px rgba(220,31,31,.10)',
                  }
                : {
                    background: 'transparent',
                    borderLeft: '2px solid transparent',
                    paddingLeft: '10px',
                  }
            }
          >
            {({ isActive }) => (
              <>
                <it.icon
                  size={16}
                  style={{ color: isActive ? '#DC1F1F' : undefined }}
                  className={isActive ? '' : 'group-hover:text-[#DFF5EB] transition-colors'}
                />
                {it.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="p-4 text-[11px] font-mono shrink-0"
        style={{
          borderTop: '1px solid rgba(255,255,255,.08)',
          color: 'rgba(143,168,160,.45)',
        }}
      >
        v0.1 · {USE_MOCK ? 'mock' : 'live'}
      </div>
    </aside>
  );
}
