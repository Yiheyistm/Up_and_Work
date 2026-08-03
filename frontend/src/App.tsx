/**
 * App.tsx — Root Application Shell
 *
 * Handles:
 *  - Authentication gate: renders Login page until a valid JWT is confirmed
 *  - Left sidebar navigation with badge counts
 *  - Route definitions for all pages
 *  - Logout button in the sidebar footer
 */

import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Target, MessageSquare, Settings, BarChart, Mail, Menu, X, LogOut, Loader2 } from 'lucide-react';
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

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  mobileOpen,
  onClose,
  email,
  onLogout,
}: {
  mobileOpen: boolean;
  onClose: () => void;
  email: string | null;
  onLogout: () => void;
}) {
  const location = useLocation();
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

  const links = [
    { path: '/',          label: 'Dashboard',  icon: LayoutDashboard },
    { path: '/tracker',   label: 'Tracker',    icon: Target },
    { path: '/chat',      label: 'AI Chat',    icon: MessageSquare, badge: unreadCount },
    { path: '/invites',   label: 'Invites',    icon: Mail,          badge: inviteCount },
    { path: '/analytics', label: 'Analytics',  icon: BarChart },
    { path: '/settings',  label: 'Settings',   icon: Settings },
  ];

  return (
    <div className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} style={{
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
        {mobileOpen && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '4px' }}>
            <X size={20} />
          </button>
        )}
      </div>

      {/* Nav links */}
      {links.map(link => {
        const active = location.pathname === link.path ||
          (link.path !== '/' && location.pathname.startsWith(link.path));
        return (
          <Link
            key={link.path}
            to={link.path}
            onClick={onClose}
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
            {link.badge ? (
              <span style={{
                background: 'var(--color-accent)', color: '#fff',
                fontSize: '11px', fontWeight: 700,
                padding: '2px 6px', borderRadius: '10px',
              }}>
                {link.badge}
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

// ─── App Root ────────────────────────────────────────────────────────────────

function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
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
        {!mobileOpen && (
          <button
            onClick={() => setMobileOpen(true)}
            style={{
              position: 'fixed', top: '12px', left: '12px', zIndex: 200,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              color: 'var(--color-text)', borderRadius: 'var(--radius-sm)',
              padding: '8px', cursor: 'pointer',
            }}
            className="mobile-menu-btn"
          >
            <Menu size={20} />
          </button>
        )}

        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.5)', zIndex: 99,
            }}
            className="mobile-overlay"
          />
        )}

        <Sidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          email={email}
          onLogout={logout}
        />
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg)' }}>
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
    </BrowserRouter>
  );
}

export default App;
