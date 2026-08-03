import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiClient } from '../api/client';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Card from '../components/Card';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Job } from '../types';
import styles from './Dashboard.module.css';

let _addToast: ((msg: string, type?: 'success' | 'error' | 'info') => void) | null = null;

export function toast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  _addToast?.(msg, type);
}

function ToastContainer() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);

  _addToast = (msg, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const colorMap: Record<string, string> = {
    success: 'var(--color-success)',
    error: 'var(--color-danger)',
    info: 'var(--color-accent)',
  };

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 9999 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: 'var(--color-surface-2)',
          border: `1px solid ${colorMap[t.type]}`,
          color: 'var(--color-text)',
          padding: '12px 18px',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          fontSize: '0.9rem',
          minWidth: '220px',
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [minScore, setMinScore] = useState<number | ''>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const handleAddCustomUrl = async () => {
    if (!customUrl.trim()) return;
    setAddingUrl(true);
    try {
      const { data } = await apiClient.post('/jobs/scrape-url', { url: customUrl.trim() });
      toast(`✨ Job imported: ${data.title} (${data.match_score ?? '?'}% match)`, 'success');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setShowAddModal(false);
      setCustomUrl('');
    } catch {
      toast('❌ Failed to analyze custom link.', 'error');
    } finally {
      setAddingUrl(false);
    }
  };

  const handleWsMessage = useCallback((msg: Record<string, unknown>) => {
    if (msg?.event === 'new_job') {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast(`✨ New job: ${msg.title} (${msg.match_score ?? '?'}% match)`, 'success');
    }
  }, [queryClient]);

  useWebSocket(`${import.meta.env.VITE_WS_URL || 'ws://localhost:8001'}/ws/jobs`, handleWsMessage);

  const { data: jobs, isLoading } = useQuery<Job[]>({
    queryKey: ['jobs', statusFilter, minScore],
    queryFn: () => api.getJobs(statusFilter || undefined, minScore || undefined),
    refetchInterval: 60_000,
  });

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Delete this job?')) return;
    try {
      await api.deleteJob(jobId);
      toast('🗑️ Job deleted', 'info');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    } catch {
      toast('❌ Failed to delete job', 'error');
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      await api.triggerScan();
      toast('📡 Scan triggered! New jobs will appear shortly.', 'info');
    } catch {
      toast('❌ Scan failed. Is the backend running?', 'error');
    } finally {
      setScanning(false);
    }
  };

  const filteredJobs = jobs?.filter(j =>
    !searchText ||
    j.title.toLowerCase().includes(searchText.toLowerCase()) ||
    j.required_skills?.some(s => s.toLowerCase().includes(searchText.toLowerCase()))
  ) ?? [];

  const totalPages = Math.ceil(filteredJobs.length / pageSize);
  const paginatedJobs = filteredJobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const hasActiveFilters = searchText || statusFilter || minScore;

  const handleClearFilters = () => {
    setSearchText('');
    setStatusFilter('');
    setMinScore('');
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className={styles.dashboard}>
      <ToastContainer />

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1>Job Feed</h1>
          <p>{jobs?.length ?? 0} jobs analyzed · Real-time AI matching</p>
        </div>
        <div className={styles.headerRight}>
          <Button icon={<Plus size={18} />} onClick={() => setShowAddModal(true)}>
            Add Job Link
          </Button>
          <Button icon={scanning ? <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={18} />}
            onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Scan Now'}
          </Button>
        </div>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.searchInput}>
          <Search size={16} color="var(--color-text-muted)" />
          <input
            placeholder="Search by title or skill..."
            value={searchText}
            onChange={e => { setSearchText(e.target.value); setCurrentPage(1); }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
          className={styles.filterSelect}
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="applied">Applied</option>
          <option value="ignored">Ignored</option>
        </select>

        <div className={styles.filterNumber}>
          <Filter size={14} color="var(--color-text-muted)" />
          <input
            type="number" placeholder="Min score" min={0} max={100}
            value={minScore}
            onChange={e => { setMinScore(e.target.value ? Number(e.target.value) : ''); setCurrentPage(1); }}
          />
          <span>%</span>
        </div>

        {hasActiveFilters && (
          <Button variant="secondary" size="sm" onClick={handleClearFilters}>
            <X size={14} /> Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: 'var(--space-8)' }}>
          <Skeleton lines={6} />
        </div>
      ) : (
        <>
          {paginatedJobs.length > 0 && (
            <section>
              <div className={styles.jobGrid}>
                {paginatedJobs.map(job => <JobCard key={job.id} job={job} onClick={() => navigate('/job/' + job.id)} onDelete={handleDeleteJob} />)}
              </div>
            </section>
          )}

          {paginatedJobs.length === 0 && (
            <div className={styles.emptyState}>
              {jobs?.length === 0
                ? 'No jobs yet. Click "Scan Now" to fetch new jobs from your configured feeds.'
                : 'No jobs match your current filters. Try clearing them.'}
            </div>
          )}

          {totalPages > 1 && (
            <Pagination current={currentPage} total={totalPages} onPageChange={handlePageChange} />
          )}
        </>
      )}

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add Upwork Job Link">
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: 'var(--space-4)' }}>
          Paste any Upwork job URL (e.g. <code>https://www.upwork.com/jobs/~01...</code>) to instantly analyze, score, and generate a proposal.
        </p>
        <input
          type="text"
          placeholder="https://www.upwork.com/jobs/~01..."
          value={customUrl}
          onChange={e => setCustomUrl(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            color: 'var(--color-text)', fontSize: '0.95rem', outline: 'none',
            marginBottom: 'var(--space-4)', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <Button variant="secondary" onClick={() => setShowAddModal(false)}>Cancel</Button>
          <Button onClick={handleAddCustomUrl} disabled={!customUrl.trim() || addingUrl}>
            {addingUrl ? 'Analyzing...' : 'Analyze Job'}
          </Button>
        </div>
      </Modal>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function formatBudget(job: Job): string {
  if (job.budget_type === 'Hourly' && (job.budget_min != null || job.budget_max != null)) {
    return `$${job.budget_min ?? 0}-${job.budget_max ?? 0}/hr`;
  }
  if (job.budget_min != null) {
    return `$${job.budget_min}`;
  }
  if (job.reasoning?.recommended_bid != null && job.reasoning.recommended_bid > 0) {
    return `Est. $${job.reasoning.recommended_bid}`;
  }
  if (job.budget_type) {
    return job.budget_type;
  }
  return 'Unspecified';
}

function JobCard({ job, onClick, onDelete }: { job: Job; onClick: () => void; onDelete?: (id: string) => void }) {
  const score = job.match_score ?? 0;
  const scoreColor = score >= 80 ? 'var(--score-high)' : score >= 60 ? 'var(--score-mid)' : 'var(--score-low)';

  return (
    <Card hoverable onClick={onClick}>
      {job.match_score != null && (
        <div style={{
          position: 'absolute', top: '12px', right: '12px',
          background: scoreColor, color: '#fff', fontWeight: 700,
          padding: '3px 8px', borderRadius: '6px', fontSize: '0.85rem',
        }}>
          {job.match_score}%
        </div>
      )}

      <h3 style={{ margin: '0 40px var(--space-3) 0', fontSize: '1rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {job.title}
      </h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
        <span>💰 {formatBudget(job)}</span>
        <span>📍 {job.client_country ?? 'Unknown'}</span>
        <span>🕐 {new Date(job.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-3)' }}>
        {job.required_skills?.slice(0, 3).map(skill => (
          <span key={skill} style={{ background: 'var(--color-surface-2)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
            {skill}
          </span>
        ))}
        {(job.required_skills?.length ?? 0) > 3 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', alignSelf: 'center' }}>
            +{job.required_skills.length - 3}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Badge variant={
          job.status === 'new' ? 'accent' :
            job.status === 'shortlisted' ? 'success' :
              job.status === 'applied' ? 'warning' : 'muted'
        }>
          {job.status}
        </Badge>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {(job.red_flags?.length ?? 0) > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-warning)', fontSize: '0.8rem' }}>
              ⚠️ {job.red_flags.length} flag{job.red_flags.length > 1 ? 's' : ''}
            </span>
          )}
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(job.id); }}
              style={{
                background: 'none', border: 'none', color: 'var(--color-danger)',
                cursor: 'pointer', padding: '2px 6px', borderRadius: '4px',
                fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '2px',
              }}
              title="Delete job"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
