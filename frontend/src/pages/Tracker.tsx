import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Kanban, CheckCircle, XCircle, Clock, AlertTriangle, MessageSquare, ArrowUpCircle, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Job, JobStatus } from '../types';

const STATUS_CONFIG: { key: JobStatus; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
  { key: 'new',         label: 'New',         icon: <Clock size={16} />,         color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.12)' },
  { key: 'shortlisted', label: 'Shortlisted', icon: <ArrowUpCircle size={16} />, color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },
  { key: 'applied',     label: 'Applied',     icon: <CheckCircle size={16} />,   color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
  { key: 'invited',     label: 'Invited',     icon: <MessageSquare size={16} />, color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.12)' },
  { key: 'interviewing',label: 'Interviewing',icon: <MessageSquare size={16} />, color: '#EC4899', bg: 'rgba(236, 72, 153, 0.12)' },
  { key: 'hired',       label: 'Hired',       icon: <CheckCircle size={16} />,   color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
  { key: 'rejected',    label: 'Rejected',    icon: <XCircle size={16} />,      color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
  { key: 'ignored',     label: 'Ignored',     icon: <AlertTriangle size={16} />, color: '#64748B', bg: 'rgba(100, 116, 139, 0.12)' },
];

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
    return `${job.budget_type}`;
  }
  return 'Unspecified';
}

export default function Tracker() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('');

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['jobs_tracker'],
    queryFn: () => api.getJobs(),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) => api.updateJobStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs_tracker'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const visibleColumns = filterStatus
    ? STATUS_CONFIG.filter(s => s.key === filterStatus)
    : STATUS_CONFIG;

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Kanban size={24} color="var(--color-accent)" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', lineHeight: 1.2 }}>Application Kanban Tracker</h1>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Track pipeline stages, move application statuses, and click any job card to view full AI analysis & proposals.
            </div>
          </div>
        </div>

        {/* Filter Badges Bar */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setFilterStatus('')}
            style={{
              padding: '6px 14px', borderRadius: '20px', border: filterStatus === '' ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
              background: filterStatus === '' ? 'var(--color-accent)' : 'var(--color-surface)',
              color: filterStatus === '' ? '#fff' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            All Pipeline ({jobs?.length ?? 0})
          </button>
          {STATUS_CONFIG.map(s => {
            const count = jobs?.filter(j => j.status === s.key).length ?? 0;
            const isSelected = filterStatus === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setFilterStatus(s.key)}
                style={{
                  padding: '6px 12px', borderRadius: '20px',
                  border: isSelected ? `1px solid ${s.color}` : '1px solid var(--color-border)',
                  background: isSelected ? s.color : 'var(--color-surface)',
                  color: isSelected ? '#fff' : 'var(--color-text-muted)',
                  cursor: 'pointer', fontSize: '0.8rem', fontWeight: isSelected ? 600 : 400,
                  transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '5px'
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
                {s.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--color-text-muted)', padding: 'var(--space-8)', textAlign: 'center', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
          Loading application tracker board...
        </div>
      ) : (
        <div
          style={{
            display: 'flex', gap: 'var(--space-4)', overflowX: 'auto', paddingBottom: 'var(--space-4)',
            alignItems: 'flex-start', scrollbarWidth: 'thin'
          }}
        >
          {visibleColumns.map(({ key, label, icon, color, bg }) => {
            const columnJobs = jobs?.filter(j => j.status === key) ?? [];

            return (
              <div
                key={key}
                className="tracker-col"
                style={{
                  flex: '0 0 300px', width: '300px', minWidth: '300px',
                  background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border)', borderTop: `4px solid ${color}`,
                  display: 'flex', flexDirection: 'column',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
                }}
              >
                {/* Column Header */}
                <div style={{
                  padding: 'var(--space-4)', borderBottom: '1px solid var(--color-border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-surface-2)',
                  borderTopLeftRadius: 'var(--radius-lg)', borderTopRightRadius: 'var(--radius-lg)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color, fontWeight: 700, fontSize: '0.95rem' }}>
                    {icon}
                    <span>{label}</span>
                  </div>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 700, color, background: bg,
                    padding: '2px 8px', borderRadius: '12px'
                  }}>
                    {columnJobs.length}
                  </span>
                </div>

                {/* Job Cards List */}
                <div style={{ padding: 'var(--space-3)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {columnJobs.map(job => {
                    const score = job.match_score ?? 0;
                    const scoreBg = score >= 80 ? 'rgba(34,197,94,0.15)' : score >= 60 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';
                    const scoreBorder = score >= 80 ? 'var(--color-success)' : score >= 60 ? 'var(--color-warning)' : 'var(--color-danger)';
                    const scoreTextColor = score >= 80 ? 'var(--color-success)' : score >= 60 ? 'var(--color-warning)' : 'var(--color-danger)';

                    return (
                      <div
                        key={job.id}
                        onClick={() => navigate(`/job/${job.id}`)}
                        style={{
                          background: 'var(--color-surface-2)', padding: 'var(--space-3) var(--space-4)',
                          borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                          cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s, box-shadow 0.15s',
                          position: 'relative',
                        }}
                        onMouseOver={e => {
                          e.currentTarget.style.borderColor = 'var(--color-accent)';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
                        }}
                        onMouseOut={e => {
                          e.currentTarget.style.borderColor = 'var(--color-border)';
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        {/* Title & Match Score Badge */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                          <h4 style={{
                            margin: 0, fontSize: '0.9rem', lineHeight: 1.35, fontWeight: 600, color: 'var(--color-text)',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                          }}>
                            {job.title}
                          </h4>
                          {job.match_score != null && (
                            <span style={{
                              fontSize: '0.72rem', fontWeight: 800, color: scoreTextColor,
                              background: scoreBg, border: `1px solid ${scoreBorder}`,
                              padding: '2px 6px', borderRadius: '4px', flexShrink: 0
                            }}>
                              {job.match_score}%
                            </span>
                          )}
                        </div>

                        {/* Metadata Pills */}
                        <div style={{ display: 'flex', gap: '8px', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>💰 {formatBudget(job)}</span>
                          {job.client_country && <span>📍 {job.client_country}</span>}
                        </div>

                        {/* Required Skills tags */}
                        {job.required_skills && job.required_skills.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                            {job.required_skills.slice(0, 2).map((skill, idx) => (
                              <span key={idx} style={{ background: 'var(--color-bg)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                                {skill}
                              </span>
                            ))}
                            {job.required_skills.length > 2 && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', alignSelf: 'center' }}>
                                +{job.required_skills.length - 2}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Status Change Selector & Open Link */}
                        <div
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '6px'
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <select
                            value={job.status}
                            onChange={e => statusMutation.mutate({ id: job.id, status: e.target.value as JobStatus })}
                            style={{
                              background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                              color: 'var(--color-text-muted)', fontSize: '0.72rem', padding: '3px 6px',
                              borderRadius: 'var(--radius-sm)', cursor: 'pointer', outline: 'none'
                            }}
                          >
                            {STATUS_CONFIG.map(s => (
                              <option key={s.key} value={s.key}>
                                Move to {s.label}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={e => {
                              e.stopPropagation();
                              navigate(`/job/${job.id}`);
                            }}
                            style={{
                              background: 'none', border: 'none', color: 'var(--color-accent)',
                              fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: '2px', padding: '2px'
                            }}
                          >
                            Details <ChevronRight size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {columnJobs.length === 0 && (
                    <div style={{
                      color: 'var(--color-text-muted)', fontSize: '0.8rem', fontStyle: 'italic',
                      textAlign: 'center', padding: 'var(--space-6)', background: 'var(--color-bg)',
                      borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)'
                    }}>
                      No jobs in {label.toLowerCase()} stage
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
