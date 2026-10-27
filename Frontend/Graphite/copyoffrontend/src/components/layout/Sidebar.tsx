import { NavLink } from 'react-router-dom';
import { Database, FolderTree, MessageSquare, GitPullRequest, Wrench, Activity } from 'lucide-react';

const items = [
  { to: '/repos', label: 'Repos', icon: Database },
  { to: '/explorer', label: 'Explorer', icon: FolderTree },
  { to: '/ask', label: 'Ask', icon: MessageSquare },
  { to: '/pr-review', label: 'PR Review', icon: GitPullRequest },
  { to: '/repair', label: 'Repair', icon: Wrench },
  { to: '/status', label: 'System status', icon: Activity },
];

export default function Sidebar() {
  return (
    <aside className="w-sidebar h-screen bg-surface border-r border-border flex flex-col">
      <div className="h-topbar flex items-center px-6 border-b border-border">
        <a href="/" className="text-h4 text-text-primary hover:text-accent transition-colors">CodeXray</a>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-body-sm transition-colors ${
                isActive ? 'bg-accent-soft text-accent font-semibold' : 'text-text-secondary hover:bg-surface-muted'
              }`
            }
          >
            <it.icon size={18} />
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-border text-caption text-text-muted">
        v0.1 · mock
      </div>
    </aside>
  );
}
