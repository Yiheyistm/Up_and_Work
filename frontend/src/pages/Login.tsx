/**
 * Login.tsx — Dashboard Login Page
 *
 * Single-user login form for the Up_and_Work dashboard.
 * No sign-up — credentials are configured in .env (APP_EMAIL / APP_PASSWORD).
 *
 * On success, calls the parent onLogin() callback which triggers the auth
 * state change and redirects to the main dashboard.
 */

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, Mail, Loader2, AlertCircle, Zap } from 'lucide-react';

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  // Animate the card entrance
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      triggerShake();
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onLogin(email.trim(), password);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'Invalid credentials. Check your email and password.';
      setError(msg);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', sans-serif",
      padding: '24px',
    }}>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          15%,45%,75% { transform: translateX(-8px); }
          30%,60%,90% { transform: translateX(8px); }
        }
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0   rgba(255,107,53,0.4); }
          70%  { box-shadow: 0 0 0 16px rgba(255,107,53,0); }
          100% { box-shadow: 0 0 0 0   rgba(255,107,53,0); }
        }
        .login-field:focus { border-color: var(--color-accent) !important; outline: none; box-shadow: 0 0 0 3px rgba(255,107,53,0.15); }
        .login-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
        .login-btn:active:not(:disabled) { transform: translateY(0); }
      `}</style>

      <div style={{
        width: '100%', maxWidth: '420px',
        animation: visible ? 'fadeUp 0.5s ease both' : 'none',
      }}>

        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{
            width: '60px', height: '60px', borderRadius: '16px',
            background: 'linear-gradient(135deg, var(--color-accent), #ff9a3c)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '16px', animation: 'pulse-ring 2.5s infinite',
          }}>
            <Zap size={28} color="#fff" fill="#fff" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text)' }}>
            Up and Work
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            AI-powered Upwork job monitoring dashboard
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '16px',
          padding: '32px',
          animation: shake ? 'shake 0.5s ease' : 'none',
          boxShadow: '0 4px 40px rgba(0,0,0,0.3)',
        }}>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Sign in
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Access your personal dashboard
          </p>

          {/* Error banner */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '10px', padding: '12px 14px', marginBottom: '20px',
              color: '#EF4444', fontSize: '0.88rem', fontWeight: 500,
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Email */}
            <div>
              <label style={{
                display: 'block', fontSize: '0.8rem', fontWeight: 700,
                color: 'var(--color-text-muted)', marginBottom: '8px',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} color="var(--color-text-muted)" style={{
                  position: 'absolute', left: '14px', top: '50%',
                  transform: 'translateY(-50%)', pointerEvents: 'none',
                }} />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="login-field"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '11px 14px 11px 42px',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '10px', color: 'var(--color-text)',
                    fontSize: '0.95rem', transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{
                display: 'block', fontSize: '0.8rem', fontWeight: 700,
                color: 'var(--color-text-muted)', marginBottom: '8px',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} color="var(--color-text-muted)" style={{
                  position: 'absolute', left: '14px', top: '50%',
                  transform: 'translateY(-50%)', pointerEvents: 'none',
                }} />
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="login-field"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '11px 44px 11px 42px',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '10px', color: 'var(--color-text)',
                    fontSize: '0.95rem', transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{
                    position: 'absolute', right: '12px', top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-muted)', padding: '4px',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              className="login-btn"
              style={{
                marginTop: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                background: loading ? 'var(--color-surface-2)' : 'var(--color-accent)',
                color: '#fff', border: 'none',
                padding: '13px', borderRadius: '10px',
                fontWeight: 700, fontSize: '1rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                opacity: loading ? 0.8 : 1,
              }}
            >
              {loading
                ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Signing in…</>
                : 'Sign in to Dashboard'
              }
            </button>
          </form>
        </div>

        {/* Footer hint */}
        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Credentials are set in <code style={{ background: 'var(--color-surface)', padding: '1px 6px', borderRadius: '4px' }}>.env</code> via <code style={{ background: 'var(--color-surface)', padding: '1px 6px', borderRadius: '4px' }}>APP_EMAIL</code> / <code style={{ background: 'var(--color-surface)', padding: '1px 6px', borderRadius: '4px' }}>APP_PASSWORD</code>
        </p>
      </div>
    </div>
  );
}
