/**
 * App.tsx — Root Application Shell
 *
 * Handles:
 *  - Authentication gate: renders Login page until a valid JWT is confirmed
 *  - Left sidebar navigation with badge counts (desktop ≥769px)
 *  - Mobile bottom navigation bar (≤768px) replacing the hamburger drawer
 *  - Route definitions for all pages
 *  - Logout button in the sidebar footer (desktop) / Settings page (mobile)
 */

import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Target, MessageSquare, Settings, BarChart, Mail, LogOut, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import JobDetail from './pages/JobDetail';
import Tracker from './pages/Tracker';
import AiChat from './pages/AiChat';
import Analytics from './pages/Analytics';
import SettingsPage from './pages/Settings';
import Invites from './pages/Invites';
import Login from './pages/Login';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './store/appStore';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './api/client';
import type { InviteNotification } from './types';

// ─── Navigation definition ─────────────────────────────────────────────────────
// Single source of truth shared by the desktop sidebar (all links) and the
// mobile bottom nav (Analytics is intentionally excluded — reachable via
// Settings on small screens).

interface NavLink {
  path: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: 'unread' | 'invites';
}

const NAV_LINKS: NavLink[] = [
  { path: '/',          label: 'Dashboard', icon: LayoutDashboard },
  { path: '/tracker',   label: 'Tracker',   icon: Target },
  { path: '/chat',      label: 'AI Chat',   icon: MessageSquare, badgeKey: 'unread' },
  { path: '/invites',   label: 'Invites',   icon: Mail,          badgeKey: 'invites' },
  { path: '/analytics', label: 'Analytics', icon: BarChart },
  { path: '/settings',  label: 'Settings',  icon: Settings },
];

function isLinkActive(locationPath: string, linkPath: string): boolean {
  return locationPath === linkPath ||
    (linkPath !== '/' && locationPath.startsWith(linkPath));
}

// Shared hook: live badge counts for AI Chat (unread messages) and Invites.
function useNavBadges() {
  const unreadCount = useAppStore(s => s.unreadCount);

  const { data: invites } = useQuery({
    queryKey: ['invites_sidebar'],
    queryFn: async () => {
      const { data } = await apiClient.get('/invites');
      return data as InviteNotification[];
    },
    refetchInterval: 30_000,
  });

  const inviteCount = invites?.length ?? 0;

  return (link: NavLink): number | undefined =>
    link.badgeKey === 'unread' ? unreadCount
      : link.badgeKey === 'invites' ? inviteCount
      : undefined;
}

// ─── Sidebar (desktop) ────────────────────────────────────────────────────────

function Sidebar({
  email,
  onLogout,
}: {
  email: string | null;
  onLogout: () => void;
}) {
  const location = useLocation();
  const getBadge = useNavBadges();

  return (
    <div className="sidebar" style={{
      background: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      height: '100vh',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-1)',
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2)' }}>
          <img src="/logo.png" alt="Up_and_Work Logo" style={{ width: '34px', height: '34px', borderRadius: '8px', objectFit: 'cover', border: '1px solid var(--color-border)' }} />
          <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text)' }}>Up and Work</span>
        </div>
      </div>

      {/* Nav links */}
      {NAV_LINKS.map(link => {
        const active = isLinkActive(location.pathname, link.path);
        const badge = getBadge(link);
        return (
          <Link
            key={link.path}
            to={link.path}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: '10px var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: active ? 'var(--color-surface-2)' : 'transparent',
              color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
              textDecoration: 'none',
              fontWeight: active ? 600 : 400,
              fontSize: '0.95rem',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseOver={e => { if (!active) e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseOut={e => { if (!active) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <link.icon size={18} />
            <span style={{ flex: 1 }}>{link.label}</span>
            {badge ? (
              <span style={{
                background: 'var(--color-accent)', color: '#fff',
                fontSize: '11px', fontWeight: 700,
                padding: '2px 6px', borderRadius: '10px',
              }}>
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* User + Logout footer */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        paddingTop: '12px',
        marginTop: '4px',
      }}>
        <div style={{
          fontSize: '0.78rem', color: 'var(--color-text-muted)',
          padding: '0 8px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {email ?? 'Signed in'}
        </div>
        <button
          onClick={onLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            width: '100%', padding: '9px 12px',
            background: 'transparent', border: '1px solid transparent',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer', fontSize: '0.9rem',
            transition: 'all 0.15s', textAlign: 'left',
          }}
          onMouseOver={e => {
            e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
            e.currentTarget.style.color = '#EF4444';
            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)';
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-muted)';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}

// ─── Bottom nav (mobile ≤768px) ───────────────────────────────────────────────
// Replaces the old hamburger drawer. Analytics is intentionally left out on
// small screens — it is reachable via Settings.

function BottomNav() {
  const location = useLocation();
  const getBadge = useNavBadges();

  return (
    <nav className="bottom-nav" aria-label="Bottom navigation">
      {NAV_LINKS.filter(link => link.path !== '/analytics').map(link => {
        const active = isLinkActive(location.pathname, link.path);
        const badge = getBadge(link);
        return (
          <Link
            key={link.path}
            to={link.path}
            className={`bottom-nav-link${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="bottom-nav-icon">
              <link.icon size={20} strokeWidth={active ? 2.4 : 2} />
              {badge != null && badge > 0 && (
                <span className="bottom-nav-badge">{badge > 99 ? '99+' : badge}</span>
              )}
            </span>
            <span className="bottom-nav-label">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ─── App Root ────────────────────────────────────────────────────────────────

function App() {
  const { isAuthenticated, isLoading, email, login, logout } = useAuth();

  // While verifying stored token — show a minimal spinner
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg)', color: 'var(--color-text-muted)', flexDirection: 'column', gap: '16px',
      }}>
        <style>{`@keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }`}</style>
        <Loader2 size={36} color="var(--color-accent)" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '0.9rem' }}>Verifying session…</span>
      </div>
    );
  }

  // Not authenticated → show login page (no sidebar/routes)
  if (!isAuthenticated) {
    return <Login onLogin={login} />;
  }

  // Authenticated → full app shell
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar email={email} onLogout={logout} />
        <div className="app-content" style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg)' }}>
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/job/:id"   element={<JobDetail />} />
            <Route path="/tracker"   element={<Tracker />} />
            <Route path="/chat"      element={<AiChat />} />
            <Route path="/invites"   element={<Invites />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Routes>
        </div>
      </div>
      <BottomNav />
    </BrowserRouter>
  );
}

export default App;