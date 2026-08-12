/**
 * Settings.tsx — Central Configuration Hub
 *
 * This page is the single source of truth for all user-configurable settings
 * in Up_and_Work. It uses a left-sidebar tab layout with 7 sections:
 *
 *  1. Profile      — name, title, summary, contact links
 *  2. AI & Match   — target rate, min budget, match threshold, cover letter tone
 *  3. Skills       — candidate skill tags used by the AI scoring pipeline
 *  4. Red Flags    — excluded keywords that trigger match penalties
 *  5. Feeds        — Upwork RSS / search URLs for the background scanner
 *  6. Integrations — masked API keys / credentials with test-connection buttons
 *  7. System       — health status, manual scan trigger, scheduler intervals
 *
 * All profile data is stored in config/profile.json via the /api/v1/profile/ endpoint.
 * System status is read from /api/v1/system/status (never exposes raw secrets).
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  User, Bot, Tag, ShieldAlert, Rss, Link2, Settings as SettingsIcon,
  Save, Plus, X, Eye, EyeOff, CheckCircle, XCircle, Loader2,
  Play, RefreshCw, Wifi, Activity, Download, Upload, FileJson,
  BarChart, LogOut,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';

// ─── Tab definitions ──────────────────────────────────────────────────────────
type TabId = 'profile' | 'ai' | 'skills' | 'redflags' | 'feeds' | 'integrations' | 'system';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'profile',      label: 'Profile',       icon: <User size={18} /> },
  { id: 'ai',          label: 'AI & Matching',  icon: <Bot size={18} /> },
  { id: 'skills',      label: 'Skills',         icon: <Tag size={18} /> },
  { id: 'redflags',    label: 'Red Flags',      icon: <ShieldAlert size={18} /> },
  { id: 'feeds',       label: 'Search Feeds',   icon: <Rss size={18} /> },
  { id: 'integrations',label: 'Integrations',   icon: <Link2 size={18} /> },
  { id: 'system',      label: 'System',         icon: <SettingsIcon size={18} /> },
];

// ─── Shared UI primitives ─────────────────────────────────────────────────────
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  color: 'var(--color-text)', borderRadius: '8px',
  outline: 'none', boxSizing: 'border-box', fontSize: '0.95rem',
  height: '42px',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)',
  marginBottom: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px',
};
const sectionStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  padding: '20px 24px',
  borderRadius: '12px',
  border: '1px solid var(--color-border)',
  borderTop: '2px solid var(--color-accent)',
  display: 'flex', flexDirection: 'column', gap: '18px',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.95rem', fontWeight: 700, margin: '0 0 2px',
  display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text)',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function Settings() {
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const navigate = useNavigate();
  const { email: accountEmail, logout } = useAuth();

  // ── Profile fields ──
  const [name, setName]               = useState('');
  const [title, setTitle]             = useState('');
  const [summary, setSummary]         = useState('');
  const [email, setEmail]             = useState('');
  const [phone, setPhone]             = useState('');
  const [location, setLocation]       = useState('');
  const [linkedin, setLinkedin]       = useState('');
  const [github, setGithub]           = useState('');

  // ── AI & Matching fields ──
  const [targetRate, setTargetRate]           = useState(50);
  const [minFixedBudget, setMinFixedBudget]   = useState(500);
  const [matchThreshold, setMatchThreshold]   = useState(70);
  const [preferredTone, setPreferredTone]     = useState('professional');

  // ── Skills / Red Flags / Feeds ──
  const [skills, setSkills]                   = useState<string[]>([]);
  const [newSkill, setNewSkill]               = useState('');
  const [excludedKeywords, setExcludedKw]     = useState<string[]>([]);
  const [newKw, setNewKw]                     = useState('');
  const [rssFeeds, setRssFeeds]               = useState<string[]>([]);
  const [newFeed, setNewFeed]                 = useState('');

  // ── Integration test state ──
  const [emailTestStatus, setEmailTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [emailTestMsg, setEmailTestMsg]       = useState('');
  const [showSecrets, setShowSecrets]         = useState<Record<string, boolean>>({});

  // ── System actions ──
  const [scanLoading, setScanLoading]         = useState(false);

  // ── Import / Export state ──
  const [exportLoading, setExportLoading]     = useState(false);
  const [importLoading, setImportLoading]     = useState(false);
  const [importPreview, setImportPreview]     = useState<any>(null);   // parsed JSON before confirming
  const [importFileName, setImportFileName]   = useState('');
  const [importError, setImportError]         = useState('');
  const [importPendingFile, setImportPendingFile] = useState<File | null>(null);

  // ── Fetch profile on mount ──
  const [profileLoading, setProfileLoading]   = useState(true);

  useEffect(() => {
    api.getProfile().then(d => {
      if (!d) return;
      setName(d.name || '');
      setTitle(d.title || '');
      setSummary(d.person?.summary || '');
      setEmail(d.person?.contact?.email || '');
      setPhone(d.person?.contact?.phone || '');
      setLocation(d.person?.contact?.location || '');
      setLinkedin(d.person?.contact?.profiles?.linkedin || '');
      setGithub(d.person?.contact?.profiles?.github || '');
      setTargetRate(d.target_rate || 50);
      setMinFixedBudget(d.min_fixed_budget || 500);
      setMatchThreshold(d.match_score_threshold || 70);
      setPreferredTone(d.preferred_tone || 'professional');
      setSkills(d.skills || []);
      setExcludedKw(d.excluded_keywords || []);
      setRssFeeds(d.rss_feeds || []);
    }).catch(() => showToast('Failed to load profile.', false))
      .finally(() => setProfileLoading(false));
  }, []);

  // ── System status query ──
  const { data: systemStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.getSystemStatus(),
    refetchInterval: 30_000,
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const showToast = (text: string, ok: boolean) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const buildProfilePayload = () => ({
    name, title,
    target_rate: Number(targetRate),
    min_fixed_budget: Number(minFixedBudget),
    match_score_threshold: Number(matchThreshold),
    preferred_tone: preferredTone,
    skills,
    excluded_keywords: excludedKeywords,
    rss_feeds: rssFeeds,
    person: {
      name, title,
      summary,
      contact: {
        email, phone, location,
        profiles: { linkedin, github },
      },
    },
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateProfile(buildProfilePayload());
      showToast('Settings saved successfully.', true);
    } catch {
      showToast('Failed to save settings.', false);
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setEmailTestStatus('loading');
    setEmailTestMsg('');
    try {
      const result = await api.testEmailConnection();
      setEmailTestStatus(result.success ? 'ok' : 'error');
      setEmailTestMsg(result.message);
    } catch {
      setEmailTestStatus('error');
      setEmailTestMsg('Request failed — is the backend running?');
    }
  };

  const handleTriggerScan = async () => {
    setScanLoading(true);
    try {
      await api.triggerScan();
      showToast('RSS scan triggered. New jobs will appear shortly.', true);
    } catch {
      showToast('Failed to trigger scan.', false);
    } finally {
      setScanLoading(false);
    }
  };

  // ── Export: download profile.json ──────────────────────────────────────────
  const handleExport = async () => {
    setExportLoading(true);
    try {
      await api.exportProfile();
      showToast('Profile exported successfully.', true);
    } catch {
      showToast('Failed to export profile.', false);
    } finally {
      setExportLoading(false);
    }
  };

  // ── Import: read file → preview → confirm ─────────────────────────────────
  const handleImportFileSelect = (file: File) => {
    setImportError('');
    setImportPreview(null);
    setImportPendingFile(null);
    if (!file.name.endsWith('.json')) {
      setImportError('Only .json files are supported.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        setImportPreview(parsed);
        setImportFileName(file.name);
        setImportPendingFile(file);
      } catch {
        setImportError('Invalid JSON — could not parse the file.');
      }
    };
    reader.readAsText(file);
  };

  const handleImportConfirm = async () => {
    if (!importPendingFile) return;
    setImportLoading(true);
    try {
      const result = await api.importProfile(importPendingFile);
      showToast(`Profile imported! (${result.fields_imported?.length ?? 0} fields)`, true);
      // Reload the form with the newly imported data
      const d = result.profile;
      if (d) {
        setName(d.name || ''); setTitle(d.title || '');
        setSummary(d.person?.summary || '');
        setEmail(d.person?.contact?.email || '');
        setPhone(d.person?.contact?.phone || '');
        setLocation(d.person?.contact?.location || '');
        setLinkedin(d.person?.contact?.profiles?.linkedin || '');
        setGithub(d.person?.contact?.profiles?.github || '');
        setTargetRate(d.target_rate || 50);
        setMinFixedBudget(d.min_fixed_budget || 500);
        setMatchThreshold(d.match_score_threshold || 70);
        setPreferredTone(d.preferred_tone || 'professional');
        setSkills(d.skills || []);
        setExcludedKw(d.excluded_keywords || []);
        setRssFeeds(d.rss_feeds || []);
      }
      setImportPreview(null); setImportPendingFile(null); setImportFileName('');
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'Import failed.';
      setImportError(msg);
    } finally {
      setImportLoading(false);
    }
  };

  const toggleSecret = (key: string) =>
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));

  const addItem = (list: string[], setList: (v: string[]) => void, val: string, setVal: (v: string) => void) => {
    const trimmed = val.trim();
    if (trimmed && !list.includes(trimmed)) {
      setList([...list, trimmed]);
      setVal('');
    }
  };

  // ─── Save button ─────────────────────────────────────────────────────────────
  const SaveButton = () => (
    <button
      onClick={handleSave}
      disabled={saving}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'var(--color-accent)', color: '#fff', border: 'none',
        padding: '10px 22px', borderRadius: 'var(--radius-md)',
        fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
        fontSize: '0.95rem', opacity: saving ? 0.7 : 1, transition: 'opacity 0.2s',
      }}
    >
      {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  );

  // ─── Tag chips ────────────────────────────────────────────────────────────────
  const TagChip = ({ label, color, onRemove }: { label: string; color: string; onRemove: () => void }) => (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      padding: '5px 12px', borderRadius: '20px', fontSize: '0.88rem',
      fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px',
    }}>
      {label}
      <X size={13} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={onRemove} />
    </span>
  );

  // ─── Add-item row ─────────────────────────────────────────────────────────────
  const AddRow = ({
    value, onChange, onAdd, placeholder, maxWidth,
  }: {
    value: string; onChange: (v: string) => void; onAdd: () => void;
    placeholder: string; maxWidth?: string;
  }) => (
    <div style={{ display: 'flex', gap: '8px', maxWidth: maxWidth ?? '480px' }}>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onAdd()}
        style={{ ...fieldStyle, maxWidth: undefined }}
      />
      <button onClick={onAdd} style={{
        background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
        color: 'var(--color-text)', padding: '0 14px', borderRadius: 'var(--radius-md)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
        whiteSpace: 'nowrap', fontWeight: 600, fontSize: '0.88rem',
      }}>
        <Plus size={15} /> Add
      </button>
    </div>
  );

  // ─── Loading skeleton ─────────────────────────────────────────────────────────
  if (profileLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', flexDirection: 'column', gap: '16px', color: 'var(--color-text-muted)' }}>
        <Loader2 size={36} style={{ animation: 'spin 1s linear infinite', color: 'var(--color-accent)' }} />
        <span>Loading configuration…</span>
        <style>{`@keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }`}</style>
      </div>
    );
  }

  // ─── Integration masked field ─────────────────────────────────────────────────
  const MaskedField = ({ label, masked, fieldKey, isSet }: {
    label: string; masked: string; fieldKey: string; isSet: boolean;
  }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <div style={{
          ...fieldStyle, flex: 1, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '0.88rem',
          color: isSet ? 'var(--color-text)' : 'var(--color-text-muted)',
        }}>
          <span>{showSecrets[fieldKey] ? masked : (isSet ? '••••••••••••••••' : 'Not configured')}</span>
          {isSet && (
            <button onClick={() => toggleSecret(fieldKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0', display: 'flex' }}>
              {showSecrets[fieldKey] ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
        </div>
        <span style={{
          padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 700,
          background: isSet ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          color: isSet ? '#10B981' : '#EF4444', whiteSpace: 'nowrap',
        }}>
          {isSet ? '✓ Set' : '✗ Missing'}
        </span>
      </div>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="settings-root" style={{ display: 'flex', overflow: 'hidden' }}>
      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        .settings-tab-btn:hover { background: rgba(255,255,255,0.05) !important; }
        textarea { font-family: inherit; height: auto !important; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.5; }
        select { height: 42px !important; }
        .settings-main-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 28px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg);
          position: sticky;
          top: 0;
          z-index: 10;
          flex-shrink: 0;
          gap: 16px;
        }
        .settings-main-content {
          padding: 20px 28px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div className="toast-container" style={{
          zIndex: 10000,
          background: toast.ok ? '#10B981' : '#EF4444', color: '#fff',
          padding: '12px 20px', borderRadius: 'var(--radius-md)',
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', animation: 'fadeIn 0.2s',
        }}>
          {toast.ok ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {toast.text}
        </div>
      )}

      {/* ── Left Sidebar Nav (horizontal scroll strip on mobile) ── */}
      <nav className="settings-nav">
        <div className="settings-nav-header" style={{ padding: '0 8px 12px', borderBottom: '1px solid var(--color-border)', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SettingsIcon size={22} color="var(--color-accent)" />
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem' }}>Settings</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Configuration Hub</div>
            </div>
          </div>
        </div>

        {TABS.map(tab => (
          <button
            key={tab.id}
            className="settings-tab-btn"
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', borderRadius: 'var(--radius-md)',
              background: activeTab === tab.id ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
              border: activeTab === tab.id ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
              cursor: 'pointer', width: '100%', textAlign: 'left',
              fontSize: '0.9rem', fontWeight: activeTab === tab.id ? 700 : 500,
              transition: 'all 0.15s',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        {/* Mobile-only Nav footer: Analytics shortcut + account / sign out
            (On desktop, sidebar already has Analytics & logout, so hidden via settings-mobile-only) */}
        <div className="settings-mobile-only" style={{
          marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--color-border)',
          display: 'flex', flexDirection: 'column', gap: '6px',
        }}>
          <button
            onClick={() => navigate('/analytics')}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', borderRadius: 'var(--radius-md)',
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
              color: 'var(--color-accent)', cursor: 'pointer',
              fontSize: '0.9rem', fontWeight: 600, transition: 'all 0.15s', textAlign: 'left',
            }}
          >
            <BarChart size={17} /> Analytics
          </button>
          <div style={{
            fontSize: '0.75rem', color: 'var(--color-text-muted)',
            padding: '4px 12px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {accountEmail ?? 'Signed in'}
          </div>
          <button
            onClick={logout}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 'var(--radius-sm)', color: '#EF4444',
              cursor: 'pointer', fontSize: '0.9rem', transition: 'all 0.15s', textAlign: 'left', fontWeight: 600,
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* ══════════ TAB: PROFILE ══════════ */}
        {activeTab === 'profile' && (
          <>
            <div className="settings-main-header">
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Candidate Profile</h1>
                <p style={{ margin: '2px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Personal info used to personalize AI cover letters and proposals.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={handleExport}
                  disabled={exportLoading}
                  title="Export profile as JSON"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '7px',
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text)', padding: '9px 16px', borderRadius: '8px',
                    cursor: exportLoading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.88rem',
                    opacity: exportLoading ? 0.7 : 1,
                  }}
                >
                  {exportLoading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={15} />}
                  Export JSON
                </button>
                <SaveButton />
              </div>
            </div>
            <div className="settings-main-content">

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><User size={17} color="var(--color-accent)" /> Identity</h2>
              <div className="settings-grid-2">
                <div>
                  <label style={labelStyle}>Full Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Professional Title</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={fieldStyle} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Professional Summary</label>
                <textarea
                  value={summary} onChange={e => setSummary(e.target.value)} rows={4}
                  style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
                />
              </div>
            </div>

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Link2 size={17} color="var(--color-accent)" /> Contact & Links</h2>
              <div className="settings-grid-2">
                <div>
                  <label style={labelStyle}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Phone</label>
                  <input type="text" value={phone} onChange={e => setPhone(e.target.value)} style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Location</label>
                  <input type="text" value={location} onChange={e => setLocation(e.target.value)} style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>LinkedIn URL</label>
                  <input type="url" value={linkedin} onChange={e => setLinkedin(e.target.value)} style={fieldStyle} placeholder="https://linkedin.com/in/..." />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>GitHub URL</label>
                  <input type="url" value={github} onChange={e => setGithub(e.target.value)} style={fieldStyle} placeholder="https://github.com/..." />
                </div>
              </div>
            </div>
            </div>
          </>
        )}

        {/* ══════════ TAB: AI & MATCHING ══════════ */}
        {activeTab === 'ai' && (
          <>
            <div className="settings-main-header">
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>AI & Matching</h1>
                <p style={{ margin: '2px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Controls how Gemini scores jobs and how proposals are drafted.
                </p>
              </div>
              <SaveButton />
            </div>
            <div className="settings-main-content">

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Bot size={17} color="var(--color-accent)" /> Rate & Budget Filters</h2>
              <div className="settings-grid-2">
                <div>
                  <label style={labelStyle}>Target Hourly Rate ($/hr)</label>
                  <input type="number" value={targetRate} onChange={e => setTargetRate(Number(e.target.value))} style={fieldStyle} min={1} />
                </div>
                <div>
                  <label style={labelStyle}>Min Fixed Budget ($)</label>
                  <input type="number" value={minFixedBudget} onChange={e => setMinFixedBudget(Number(e.target.value))} style={fieldStyle} min={1} />
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Activity size={17} color="var(--color-accent)" /> Match Score Threshold</h2>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
                Jobs scoring below this threshold are flagged as low-priority. Default: 70.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <input
                  type="range" min={0} max={100} value={matchThreshold}
                  onChange={e => setMatchThreshold(Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--color-accent)', height: '6px', minWidth: 0 }}
                />
                <span style={{
                  minWidth: '52px', textAlign: 'center', fontWeight: 800, fontSize: '1.6rem',
                  color: matchThreshold >= 80 ? '#10B981' : matchThreshold >= 60 ? '#F59E0B' : '#EF4444',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {matchThreshold}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', paddingRight: '68px' }}>
                <span>0 · All jobs</span><span>50 · Moderate</span><span>100 · Perfect</span>
              </div>
            </div>

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Bot size={17} color="var(--color-accent)" /> Cover Letter Tone</h2>
              <div style={{ maxWidth: '320px' }}>
                <label style={labelStyle}>Preferred Writing Tone</label>
                <select value={preferredTone} onChange={e => setPreferredTone(e.target.value)} style={fieldStyle}>
                  <option value="professional">Professional & Direct</option>
                  <option value="conversational">Conversational & Friendly</option>
                  <option value="assertive">Assertive & Expert</option>
                </select>
              </div>
            </div>
            </div>
          </>
        )}

        {/* ══════════ TAB: SKILLS ══════════ */}
        {activeTab === 'skills' && (
          <>
            <div className="settings-main-header">
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Core Skills</h1>
                <p style={{ margin: '2px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Gemini uses these to calculate match scores and highlight strengths on job cards.
                </p>
              </div>
              <SaveButton />
            </div>
            <div className="settings-main-content">

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Tag size={17} color="var(--color-accent)" /> Skill Tags ({skills.length})</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', minHeight: '40px' }}>
                {skills.length === 0 && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>No skills added yet.</span>}
                {skills.map(s => (
                  <TagChip key={s} label={s} color="var(--color-accent)" onRemove={() => setSkills(skills.filter(x => x !== s))} />
                ))}
              </div>
              <AddRow
                value={newSkill} onChange={setNewSkill} placeholder="Add skill (e.g. Python, Flutter)…"
                onAdd={() => addItem(skills, setSkills, newSkill, setNewSkill)}
              />
            </div>
            </div>
          </>
        )}

        {/* ══════════ TAB: RED FLAGS ══════════ */}
        {activeTab === 'redflags' && (
          <>
            <div className="settings-main-header">
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Red Flags</h1>
                <p style={{ margin: '2px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Jobs containing these keywords get match penalties or warning badges.
                </p>
              </div>
              <SaveButton />
            </div>
            <div className="settings-main-content">

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><ShieldAlert size={17} color="#EF4444" /> Excluded Keywords ({excludedKeywords.length})</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', minHeight: '40px' }}>
                {excludedKeywords.length === 0 && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>No keywords added yet.</span>}
                {excludedKeywords.map(kw => (
                  <TagChip key={kw} label={kw} color="#EF4444" onRemove={() => setExcludedKw(excludedKeywords.filter(x => x !== kw))} />
                ))}
              </div>
              <AddRow
                value={newKw} onChange={setNewKw} placeholder="Add keyword (e.g. unpaid, WordPress)…"
                onAdd={() => addItem(excludedKeywords, setExcludedKw, newKw, setNewKw)}
              />
            </div>
            </div>
          </>
        )}

        {/* ══════════ TAB: FEEDS ══════════ */}
        {activeTab === 'feeds' && (
          <>
            <div className="settings-main-header">
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Search Feeds</h1>
                <p style={{ margin: '2px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Upwork search URLs polled by the background scanner every {systemStatus?.config?.poll_interval_seconds ?? '…'}s.
                </p>
              </div>
              <SaveButton />
            </div>
            <div className="settings-main-content">

            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Rss size={17} color="var(--color-accent)" /> Active Feeds ({rssFeeds.length})</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {rssFeeds.length === 0 && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>No feeds configured.</span>}
                {rssFeeds.map(feed => (
                  <div key={feed} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--color-bg)', padding: '9px 14px',
                    borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.84rem', color: 'var(--color-text)', wordBreak: 'break-all', marginRight: '12px' }}>{feed}</span>
                    <X size={15} style={{ cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }} onClick={() => setRssFeeds(rssFeeds.filter(f => f !== feed))} />
                  </div>
                ))}
              </div>
              <AddRow
                value={newFeed} onChange={setNewFeed} maxWidth="100%"
                placeholder="https://www.upwork.com/nx/search/jobs/?q=fastapi"
                onAdd={() => addItem(rssFeeds, setRssFeeds, newFeed, setNewFeed)}
              />
            </div>
            </div>
          </>
        )}

        {/* ══════════ TAB: INTEGRATIONS ══════════ */}
        {activeTab === 'integrations' && (
          <>
            <div className="settings-main-header">
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Integrations</h1>
                <p style={{ margin: '2px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  API keys set via <code style={{ background: 'var(--color-surface-2)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.83rem' }}>.env</code>. Values shown masked for safety.
                </p>
              </div>
            </div>
            <div className="settings-main-content">

            {/* Gemini */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>
                <Bot size={17} color="var(--color-accent)" /> Google Gemini AI
              </h2>
              <MaskedField label="GEMINI_API_KEY" masked={systemStatus?.integrations?.gemini?.masked ?? ''} fieldKey="gemini" isSet={systemStatus?.integrations?.gemini?.set ?? false} />
            </div>

            {/* IMAP Email */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>
                <Wifi size={17} color="var(--color-accent)" /> IMAP Email (Upwork Invites)
              </h2>
              <div className="settings-grid-2" style={{ gap: '12px' }}>
                <div>
                  <label style={labelStyle}>IMAP_EMAIL</label>
                  <div style={{ ...fieldStyle, color: systemStatus?.integrations?.imap?.email ? 'var(--color-text)' : 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: '0.88rem' }}>
                    {systemStatus?.integrations?.imap?.email || 'Not configured'}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>IMAP_SERVER</label>
                  <div style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: '0.88rem', color: 'var(--color-text)' }}>
                    {systemStatus?.integrations?.imap?.server || 'imap.gmail.com'}
                  </div>
                </div>
              </div>
              <MaskedField label="IMAP_PASSWORD (App Password)" masked={systemStatus?.integrations?.imap?.masked_password ?? ''} fieldKey="imap" isSet={systemStatus?.integrations?.imap?.set ?? false} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleTestEmail}
                  disabled={emailTestStatus === 'loading'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text)', padding: '9px 18px', borderRadius: 'var(--radius-md)',
                    cursor: emailTestStatus === 'loading' ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.88rem',
                  }}
                >
                  {emailTestStatus === 'loading'
                    ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Wifi size={15} />}
                  Test Connection
                </button>
                {emailTestStatus !== 'idle' && emailTestStatus !== 'loading' && (
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem', fontWeight: 600,
                    color: emailTestStatus === 'ok' ? '#10B981' : '#EF4444',
                  }}>
                    {emailTestStatus === 'ok' ? <CheckCircle size={15} /> : <XCircle size={15} />}
                    {emailTestMsg}
                  </span>
                )}
              </div>
            </div>

            {/* Telegram */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>
                <Activity size={17} color="var(--color-accent)" /> Telegram Notifications
              </h2>
              <div className="settings-grid-2" style={{ gap: '12px' }}>
                <MaskedField label="TELEGRAM_BOT_TOKEN" masked={systemStatus?.integrations?.telegram_bot?.masked ?? ''} fieldKey="telegram" isSet={systemStatus?.integrations?.telegram_bot?.set ?? false} />
                <div>
                  <label style={labelStyle}>TELEGRAM_CHAT_ID</label>
                  <div style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: '0.88rem', color: systemStatus?.integrations?.telegram_bot?.chat_id ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {systemStatus?.integrations?.telegram_bot?.chat_id || 'Not configured'}
                  </div>
                </div>
              </div>
            </div>

            {/* Apify */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>
                <RefreshCw size={17} color="var(--color-accent)" /> Apify (Job Scraper)
              </h2>
              <MaskedField label="APIFY_API_TOKEN" masked={systemStatus?.integrations?.apify?.masked ?? ''} fieldKey="apify" isSet={systemStatus?.integrations?.apify?.set ?? false} />
            </div>

            {/* Database */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>
                <Activity size={17} color="var(--color-accent)" /> Database
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>DATABASE_URL</span>
                <span style={{
                  padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 700,
                  background: systemStatus?.integrations?.database?.set ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                  color: systemStatus?.integrations?.database?.set ? '#10B981' : '#EF4444',
                }}>
                  {systemStatus?.integrations?.database?.set ? '✓ Configured' : '✗ Missing'}
                </span>
              </div>
            </div>
            </div>
          </>
        )}

        {/* ══════════ TAB: SYSTEM ══════════ */}
        {activeTab === 'system' && (
          <>
            <div className="settings-main-header">
              <div>
                <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>System</h1>
                <p style={{ margin: '2px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Runtime controls, health monitoring, and background scanner management.
                </p>
              </div>
            </div>
            <div className="settings-main-content">

            {/* Health Badge */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Activity size={17} color="var(--color-accent)" /> Backend Health</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: systemStatus ? '#10B981' : '#EF4444',
                    animation: systemStatus ? 'pulse 2s infinite' : 'none',
                    display: 'inline-block', flexShrink: 0,
                  }} />
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: systemStatus ? '#10B981' : '#EF4444' }}>
                    {systemStatus ? 'API Online' : 'API Offline'}
                  </span>
                </div>
                {systemStatus?.server_time && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    Server time: {new Date(systemStatus.server_time).toLocaleTimeString()}
                  </span>
                )}
                <button
                  onClick={() => refetchStatus()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-muted)', padding: '6px 14px',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.85rem',
                  }}
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
            </div>

            {/* Scanner Controls */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Play size={17} color="var(--color-accent)" /> Background Scanner</h2>
              <div className="settings-grid-2">
                <div>
                  <label style={labelStyle}>RSS Poll Interval</label>
                  <div style={{ ...fieldStyle, fontFamily: 'monospace', color: 'var(--color-text)' }}>
                    {systemStatus?.config?.poll_interval_seconds ?? '—'}s
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Set via POLL_INTERVAL_SECONDS in .env</p>
                </div>
                <div>
                  <label style={labelStyle}>Email Poll Interval</label>
                  <div style={{ ...fieldStyle, fontFamily: 'monospace', color: 'var(--color-text)' }}>
                    {systemStatus?.config?.email_poll_interval_seconds ?? '—'}s
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Set via EMAIL_POLL_INTERVAL_SECONDS in .env</p>
                </div>
              </div>

              <div style={{ paddingTop: '8px', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleTriggerScan}
                  disabled={scanLoading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'var(--color-accent)', color: '#fff', border: 'none',
                    padding: '10px 20px', borderRadius: 'var(--radius-md)',
                    fontWeight: 700, cursor: scanLoading ? 'not-allowed' : 'pointer',
                    opacity: scanLoading ? 0.7 : 1, fontSize: '0.9rem', transition: 'opacity 0.2s',
                  }}
                >
                  {scanLoading
                    ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Play size={16} />}
                  {scanLoading ? 'Scanning…' : 'Trigger Manual Scan'}
                </button>
                <span style={{ fontSize: '0.83rem', color: 'var(--color-text-muted)' }}>
                  Runs the full RSS poll → AI pipeline → WebSocket broadcast now.
                </span>
              </div>
            </div>

            {/* Match Threshold read-only */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><Bot size={17} color="var(--color-accent)" /> AI Config Snapshot</h2>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {[
                  { label: 'Match Threshold', val: `${systemStatus?.config?.match_score_threshold ?? matchThreshold}` },
                  { label: 'Cover Letter Tone', val: preferredTone },
                  { label: 'Target Rate', val: `$${targetRate}/hr` },
                  { label: 'Min Fixed Budget', val: `$${minFixedBudget}` },
                ].map(({ label, val }) => (
                  <div key={label} style={{
                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', padding: '12px 20px', minWidth: '140px',
                  }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-text)' }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>{/* end section */}

            {/* ── Data Management ────────────────────────────────── */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}><FileJson size={17} color="var(--color-accent)" /> Data Management</h2>
              <p style={{ margin: 0, fontSize: '0.87rem', color: 'var(--color-text-muted)' }}>
                Export your full profile as a JSON backup, or import a profile JSON to restore or migrate settings.
              </p>

              {/* Export row */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: '10px', padding: '14px 18px', flexWrap: 'wrap', gap: '12px',
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Export Profile JSON</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                    Downloads <code style={{ background: 'var(--color-surface-2)', padding: '0 4px', borderRadius: '4px', fontSize: '0.8rem' }}>upwork_profile_YYYY-MM-DD.json</code> with all your settings.
                  </div>
                </div>
                <button
                  onClick={handleExport}
                  disabled={exportLoading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'var(--color-accent)', color: '#fff', border: 'none',
                    padding: '10px 20px', borderRadius: '8px', fontWeight: 700,
                    cursor: exportLoading ? 'not-allowed' : 'pointer', fontSize: '0.9rem',
                    opacity: exportLoading ? 0.7 : 1, flexShrink: 0,
                  }}
                >
                  {exportLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={16} />}
                  {exportLoading ? 'Exporting…' : 'Export JSON'}
                </button>
              </div>

              {/* Import drop-zone */}
              <div
                onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-accent)'; }}
                onDragLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border)'; }}
                onDrop={e => {
                  e.preventDefault();
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border)';
                  const f = e.dataTransfer.files[0];
                  if (f) handleImportFileSelect(f);
                }}
                style={{
                  border: '2px dashed var(--color-border)', borderRadius: '10px',
                  padding: '24px', textAlign: 'center', cursor: 'pointer',
                  transition: 'border-color 0.2s', position: 'relative',
                }}
                onClick={() => (document.getElementById('profile-import-input') as HTMLInputElement)?.click()}
              >
                <input
                  id="profile-import-input"
                  type="file" accept=".json" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFileSelect(f); e.target.value = ''; }}
                />
                <Upload size={28} color="var(--color-text-muted)" style={{ marginBottom: '8px' }} />
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '4px' }}>Drop profile JSON here</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>or click to browse — .json files only, max 512 KB</div>
              </div>

              {/* Import error */}
              {importError && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: '8px', color: '#EF4444', fontSize: '0.88rem', fontWeight: 600,
                }}>
                  <XCircle size={16} />{importError}
                </div>
              )}

              {/* Import preview */}
              {importPreview && (
                <div style={{
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                  borderRadius: '10px', padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileJson size={16} color="var(--color-accent)" />
                        {importFileName}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '3px' }}>
                        {Object.keys(importPreview).length} top-level fields detected
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => { setImportPreview(null); setImportPendingFile(null); setImportFileName(''); setImportError(''); }}
                        style={{
                          background: 'transparent', border: '1px solid var(--color-border)',
                          color: 'var(--color-text-muted)', padding: '7px 14px', borderRadius: '8px',
                          cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600,
                        }}
                      >Cancel</button>
                      <button
                        onClick={handleImportConfirm}
                        disabled={importLoading}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '7px',
                          background: '#10B981', color: '#fff', border: 'none',
                          padding: '7px 18px', borderRadius: '8px',
                          cursor: importLoading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.88rem',
                          opacity: importLoading ? 0.7 : 1,
                        }}
                      >
                        {importLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={14} />}
                        {importLoading ? 'Importing…' : 'Confirm & Import'}
                      </button>
                    </div>
                  </div>
                  {/* Key preview chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {Object.keys(importPreview).map(k => (
                      <span key={k} style={{
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                        borderRadius: '6px', padding: '3px 10px', fontSize: '0.78rem',
                        fontFamily: 'monospace', color: 'var(--color-text)',
                      }}>{k}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            </div>{/* end settings-main-content */}
          </>
        )}
      </main>
    </div>
  );
}
