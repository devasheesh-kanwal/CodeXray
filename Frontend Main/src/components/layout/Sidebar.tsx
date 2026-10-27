import { NavLink } from 'react-router-dom';
import { Database, FolderTree, MessageSquare, GitPullRequest, Wrench, Activity } from 'lucide-react';
import { USE_MOCK } from '../../api/client';

const items = [
  { to: '/repos',     label: 'Repos',         icon: Database },
  { to: '/explorer',  label: 'Explorer',       icon: FolderTree },
  { to: '/ask',       label: 'Ask',            icon: MessageSquare },
  { to: '/pr-review', label: 'PR Review',      icon: GitPullRequest },
  { to: '/repair',    label: 'Repair',         icon: Wrench },
  { to: '/status',    label: 'System Status',  icon: Activity },
];

export default function Sidebar() {
  return (
    <aside
      className="glass"
      style={{
        width: 240,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        borderRadius: 0,
        borderRight: '1px solid rgba(255,255,255,.12)',
        borderTop: 'none',
        borderBottom: 'none',
        borderLeft: 'none',
      }}
    >
      {/* Logo */}
      <div
        style={{
          height: 72,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          borderBottom: '1px solid rgba(255,255,255,.08)',
          flexShrink: 0,
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: '"Bodoni Moda", Georgia, serif',
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#DFF5EB',
            textDecoration: 'none',
          }}
        >
          Code
          <span style={{ color: '#DC1F1F' }}>X</span>
          ray
        </a>
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            style={{ textDecoration: 'none', display: 'block', position: 'relative' }}
          >
            {({ isActive }) => (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '9px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#DFF5EB' : '#8FA8A0',
                  background: isActive ? 'rgba(255,255,255,.07)' : 'transparent',
                  transition: 'all 0.18s ease',
                  /* gradient border on active via box-shadow */
                  boxShadow: isActive
                    ? 'inset 0 0 0 1px rgba(217,160,102,.35), 0 0 12px rgba(179,38,30,.14)'
                    : 'none',
                  cursor: 'pointer',
                }}
              >
                <it.icon
                  size={16}
                  style={{ color: isActive ? '#DC1F1F' : '#8FA8A0', flexShrink: 0 }}
                />
                {it.label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: '14px 18px',
          borderTop: '1px solid rgba(255,255,255,.08)',
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          color: 'rgba(143,168,160,.4)',
          flexShrink: 0,
        }}
      >
        v0.1 · {USE_MOCK ? 'mock' : 'live'}
      </div>
    </aside>
  );
}
