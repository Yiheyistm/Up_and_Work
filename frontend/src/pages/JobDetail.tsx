import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpCircle,
  Award,
  Check,
  CheckCircle,
  Clock,
  Copy,
  DollarSign,
  Edit3,
  ExternalLink, MessageSquare,
  RotateCcw,
  Save,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Target,
  Trash2,
  X,
  XCircle
} from 'lucide-react';
import { api, apiClient } from '../api/client';
import { useAppStore } from '../store/appStore';
import type { Job, JobStatus, ProposalDraft, ScreeningAnswer } from '../types';

let _toast: ((msg: string, type?: 'success' | 'error' | 'info') => void) | null = null;

function toast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  _toast?.(msg, type);
}

function ToastContainer() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  _toast = (msg, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} style={{
          background: 'var(--color-surface-2)', border: `1px solid var(--color-border)`,
          color: 'var(--color-text)', padding: '10px 16px', borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', fontSize: '0.85rem', minWidth: '200px',
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

const STATUS_OPTIONS: { key: JobStatus; label: string; icon: any; color: string }[] = [
  { key: 'new', label: 'New', icon: Clock, color: 'var(--color-text-muted)' },
  { key: 'shortlisted', label: 'Shortlisted', icon: ArrowUpCircle, color: '#3B82F6' },
  { key: 'applied', label: 'Applied', icon: CheckCircle, color: 'var(--color-success)' },
  { key: 'invited', label: 'Invited', icon: MessageSquare, color: '#8B5CF6' },
  { key: 'interviewing', label: 'Interviewing', icon: MessageSquare, color: '#EC4899' },
  { key: 'hired', label: 'Hired', icon: CheckCircle, color: '#10B981' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, color: 'var(--color-danger)' },
  { key: 'ignored', label: 'Ignored', icon: AlertTriangle, color: 'var(--color-warning)' },
];

function formatBudget(job: Job): string {
  if (job.budget_type === 'Hourly' && (job.budget_min != null || job.budget_max != null)) {
    return `$${job.budget_min ?? 0} - $${job.budget_max ?? 0}/hr`;
  }
  if (job.budget_min != null) {
    return `$${job.budget_min} (Fixed)`;
  }
  if (job.reasoning?.recommended_bid != null && job.reasoning.recommended_bid > 0) {
    return `Est. $${job.reasoning.recommended_bid}`;
  }
  if (job.budget_type) {
    return `${job.budget_type}`;
  }
  return 'Budget Unspecified';
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveChat = useAppStore(s => s.setActiveChat);

  // UI States
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis'>('overview');
  const [isEditingProposal, setIsEditingProposal] = useState(false);
  const [editedLetter, setEditedLetter] = useState('');

  // Copy Feedback States
  const [copiedLetter, setCopiedLetter] = useState(false);
  const [copiedQA, setCopiedQA] = useState(false);
  const [copiedJob, setCopiedJob] = useState(false);
  const [copiedQIndex, setCopiedQIndex] = useState<number | null>(null);

  const { data: job, isLoading: isLoadingJob } = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.getJob(id!),
    enabled: !!id,
  });

  const { data: proposals } = useQuery<ProposalDraft[]>({
    queryKey: ['proposals', id],
    queryFn: () => api.getProposals(id!),
    enabled: !!id,
  });

  const primaryProposal = proposals?.[0];

  const statusMutation = useMutation({
    mutationFn: (status: JobStatus) => api.updateJobStatus(id!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['jobs_tracker'] });
    },
  });

  const updateProposalMutation = useMutation({
    mutationFn: ({ proposalId, letter }: { proposalId: string; letter: string }) =>
      apiClient.put(`/proposals/${proposalId}`, {
        cover_letter: letter,
        screening_answers: primaryProposal?.screening_answers ?? [],
        suggested_bid: primaryProposal?.suggested_bid,
        timeline: primaryProposal?.timeline,
        tone: primaryProposal?.tone ?? 'professional',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals', id] });
      setIsEditingProposal(false);
    },
  });

  const regenerateProposalMutation = useMutation({
    mutationFn: () => api.regenerateProposal(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals', id] });
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      setIsEditingProposal(false);
    },
  });

  const handleOpenChat = async (promptOverride?: string) => {
    if (!job) return;
    const sessions = await api.getSessions(job.id);
    let sessionId = sessions[0]?.id;
    if (!sessionId) {
      const session = await api.createSession(`Proposal: ${job.title}`, 'job_proposal', job.id);
      sessionId = session.id;
    }
    setActiveChat(sessionId);
    navigate('/chat', { state: { autoPrompt: promptOverride } });
  };

  const handleCopyLetter = () => {
    if (!primaryProposal) return;
    const text = isEditingProposal ? editedLetter : primaryProposal.cover_letter;
    navigator.clipboard.writeText(text);
    setCopiedLetter(true);
    setTimeout(() => setCopiedLetter(false), 2000);
  };

  const handleCopyAllQA = () => {
    if (!primaryProposal?.screening_answers.length) return;
    const formatted = primaryProposal.screening_answers
      .map((q: ScreeningAnswer, idx: number) => `Q${idx + 1}: ${q.question}\nA: ${q.answer}`)
      .join('\n\n');
    navigator.clipboard.writeText(formatted);
    setCopiedQA(true);
    setTimeout(() => setCopiedQA(false), 2000);
  };

  const [copiedEverything, setCopiedEverything] = useState(false);

  const handleCopyEverything = () => {
    if (!primaryProposal) return;
    const letter = isEditingProposal ? editedLetter : primaryProposal.cover_letter;
    let fullText = `=== COVER LETTER ===\n\n${letter}\n`;
    if (primaryProposal.screening_answers?.length > 0) {
      fullText += `\n=== SCREENING ANSWERS ===\n\n`;
      primaryProposal.screening_answers.forEach((q: ScreeningAnswer, idx: number) => {
        fullText += `Q${idx + 1}: ${q.question}\nA: ${q.answer}\n\n`;
      });
    }
    navigator.clipboard.writeText(fullText.trim());
    setCopiedEverything(true);
    toast('📋 Full proposal & Q&As copied to clipboard!', 'success');
    setTimeout(() => setCopiedEverything(false), 2500);
  };

  const handleCopySingleQ = (answerText: string, index: number) => {
    navigator.clipboard.writeText(answerText);
    setCopiedQIndex(index);
    setTimeout(() => setCopiedQIndex(null), 2000);
  };

   const handleCopyJobSummary = () => {
     if (!job) return;
     const summary = `Title: ${job.title}\nLink: ${job.link || 'N/A'}\nMatch Score: ${job.match_score ?? 'N/A'}%\n\nDescription:\n${job.description}`;
     navigator.clipboard.writeText(summary);
     setCopiedJob(true);
     setTimeout(() => setCopiedJob(false), 2000);
   };

   const handleDeleteJob = async () => {
     if (!job || !confirm(`Delete "${job.title}"? This cannot be undone.`)) return;
     try {
       await api.deleteJob(job.id);
       toast('🗑️ Job deleted', 'success');
       navigate('/');
     } catch {
       toast('❌ Failed to delete job', 'error');
     }
   };

   if (isLoadingJob) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading job details & AI analysis...
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <h2>Job Not Found</h2>
        <button onClick={() => navigate('/')} style={{ background: 'var(--color-accent)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const reasoning = job.reasoning as any;
  const wordCount = (isEditingProposal ? editedLetter : primaryProposal?.cover_letter ?? '').trim().split(/\s+/).filter(Boolean).length;
  const charCount = (isEditingProposal ? editedLetter : primaryProposal?.cover_letter ?? '').length;

  return (
    <div className="jd-page" style={{ padding: 'var(--space-6)', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Top Header & Back Link */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button
          onClick={() => navigate(-1)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.9rem' }}
        >
          <ArrowLeft size={16} /> Back to jobs
        </button>

        {/* Interactive Status Workflow Pills */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
          {STATUS_OPTIONS.map(status => {
            const isActive = job.status === status.key;
            const Icon = status.icon;
            return (
              <button
                key={status.key}
                onClick={() => statusMutation.mutate(status.key)}
                disabled={statusMutation.isPending}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 10px', borderRadius: '20px',
                  border: isActive ? `1px solid ${status.color}` : '1px solid var(--color-border)',
                  background: isActive ? status.color : 'var(--color-surface)',
                  color: isActive ? '#fff' : 'var(--color-text-muted)',
                  fontSize: '0.75rem', fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <Icon size={12} /> {status.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Job Hero Header Card */}
      <div style={{ background: 'var(--color-surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <div style={{ flex: 1, minWidth: '280px' }}>
            <h1 style={{ margin: '0 0 var(--space-3) 0', fontSize: '1.4rem', lineHeight: 1.3 }}>{job.title}</h1>

            {/* Metadata Pills */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.85rem' }}>
              {/* Budget Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface-2)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)' }}>
                <DollarSign size={14} color="var(--color-accent)" />
                <span>{formatBudget(job)}</span>
              </div>

              {/* Experience Level */}
              {job.experience_level && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface-2)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)' }}>
                  <Award size={14} color="var(--color-accent)" />
                  <span>{job.experience_level} Level</span>
                </div>
              )}

              {/* Payment Verification */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface-2)', padding: '4px 10px', borderRadius: 'var(--radius-sm)' }}>
                {job.payment_verified ? (
                  <>
                    <ShieldCheck size={14} color="var(--color-success)" />
                    <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>Payment Verified</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert size={14} color="var(--color-danger)" />
                    <span style={{ color: 'var(--color-danger)' }}>Unverified Payment</span>
                  </>
                )}
              </div>

              {/* Client Rating & Location */}
              {(job.client_rating != null || job.client_country) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface-2)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)' }}>
                  {job.client_rating != null && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#F59E0B', fontWeight: 600 }}>
                      <Star size={13} fill="#F59E0B" /> {job.client_rating.toFixed(1)}
                    </span>
                  )}
                  {job.client_country && <span>📍 {job.client_country}</span>}
                </div>
              )}

              {/* Posted Date */}
              {job.posted_at && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                  <Clock size={13} /> {new Date(job.posted_at).toLocaleString()}
                </div>
              )}
            </div>
          </div>

          {/* Match Score Badge Gauge */}
          {job.match_score != null && (
            <div style={{
              background: job.match_score >= 80 ? 'rgba(34,197,94,0.1)' : job.match_score >= 60 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${job.match_score >= 80 ? 'var(--color-success)' : job.match_score >= 60 ? 'var(--color-warning)' : 'var(--color-danger)'}`,
              borderRadius: 'var(--radius-md)', padding: '12px 20px', textAlign: 'center', flexShrink: 0
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>AI Match</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: job.match_score >= 80 ? 'var(--color-success)' : job.match_score >= 60 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                {job.match_score}%
              </div>
            </div>
          )}
        </div>

        {/* Primary Action Buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
          {job.link ? (
            <a
              href={job.link}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: '#10B981', color: 'white', padding: '10px 20px',
                borderRadius: 'var(--radius-md)', textDecoration: 'none',
                fontWeight: 600, fontSize: '0.95rem', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                transition: 'transform 0.15s, background 0.15s',
              }}
            >
              <ExternalLink size={18} /> Apply on Upwork
            </a>
          ) : (
            <button disabled style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-surface-2)', color: 'var(--color-text-muted)', border: 'none', padding: '10px 20px', borderRadius: 'var(--radius-md)', cursor: 'not-allowed', fontWeight: 600, fontSize: '0.95rem' }}>
              <ExternalLink size={18} /> No Direct Link
            </button>
          )}

          <button
            onClick={() => handleOpenChat()}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'var(--color-accent)', color: 'white', border: 'none',
              padding: '10px 18px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontWeight: 600, fontSize: '0.9rem', transition: 'background 0.15s',
            }}
          >
            <MessageSquare size={16} /> Discuss with AI Copilot
          </button>

          <button
            onClick={handleCopyJobSummary}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'var(--color-surface-2)', color: 'var(--color-text)',
              border: '1px solid var(--color-border)', padding: '10px 16px',
              borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
            }}
          >
            {copiedJob ? <Check size={16} color="var(--color-success)" /> : <Share2 size={16} />}
           {copiedJob ? 'Summary Copied!' : 'Copy Summary'}
           </button>

           <button
             onClick={handleDeleteJob}
             style={{
               display: 'flex', alignItems: 'center', gap: '8px',
               background: 'transparent', color: 'var(--color-danger)',
               border: `1px solid var(--color-danger)`, padding: '10px 16px',
               borderRadius: 'var(--radius-md)', cursor: 'pointer',
               fontWeight: 600, fontSize: '0.85rem', transition: 'background 0.15s',
             }}
           >
             <Trash2 size={16} /> Delete Job
           </button>
         </div>
       </div>

      {/* Red Flags Alert Card (If Any) */}
      {job.red_flags && job.red_flags.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-6)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)', fontWeight: 700, marginBottom: '8px' }}>
            <AlertTriangle size={18} /> AI Detected Red Flags ({job.red_flags.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {job.red_flags.map((rf: string, idx: number) => (
              <div key={idx} style={{ fontSize: '0.85rem', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: 'var(--color-danger)' }}>•</span> {rf}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="jd-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-6)' }}>
        {[
          { key: 'overview', label: 'Job Overview & Requirements', icon: Tag },
          { key: 'analysis', label: 'AI Match Analysis', icon: Target },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '12px 20px', background: 'none', border: 'none',
                borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 400, cursor: 'pointer', fontSize: '0.9rem',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview & Skills */}
      {activeTab === 'overview' && (
        <div className="jd-grid-2" style={{ display: 'grid', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
          <div style={{ background: 'var(--color-surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <h3 style={{ marginTop: 0, fontSize: '1rem', marginBottom: 'var(--space-3)' }}>Full Job Description</h3>
            <div style={{ color: 'var(--color-text)', lineHeight: 1.7, fontSize: '0.9rem', whiteSpace: 'pre-wrap', maxHeight: '420px', overflowY: 'auto' }}>
              {job.description.replace(/<[^>]+>/g, '')}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Required Skills Badge Grid */}
            <div style={{ background: 'var(--color-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
              <h3 style={{ marginTop: 0, fontSize: '0.95rem', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Tag size={15} color="var(--color-accent)" /> Required Skills
              </h3>
              {job.required_skills && job.required_skills.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {job.required_skills.map((skill: string, i: number) => {
                    const isGap = reasoning?.gap_skills?.includes(skill);
                    return (
                      <span
                        key={i}
                        style={{
                          padding: '4px 10px', borderRadius: '12px',
                          background: isGap ? 'rgba(245,158,11,0.15)' : 'var(--color-surface-2)',
                          border: isGap ? '1px solid var(--color-warning)' : '1px solid var(--color-border)',
                          color: isGap ? 'var(--color-warning)' : 'var(--color-text)',
                          fontSize: '0.8rem', fontWeight: 500,
                        }}
                      >
                        {isGap ? `⚠️ ${skill}` : skill}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No specific skills extracted</div>
              )}
            </div>

            {/* Quick Context Card */}
            {job.domain && (
              <div style={{ background: 'var(--color-surface-2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>DOMAIN CATEGORY</div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-accent)' }}>{job.domain}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: AI Analysis */}
      {activeTab === 'analysis' && (
        <div style={{ background: 'var(--color-surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-6)' }}>
          {reasoning ? (
            <div className="jd-grid-1" style={{ display: 'grid', gap: 'var(--space-6)' }}>
              <div>
                <h3 style={{ marginTop: 0, color: 'var(--color-success)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle size={16} /> Candidate Match Strengths
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {reasoning.strength_points?.map((point: string, idx: number) => (
                    <div key={idx} style={{ background: 'var(--color-surface-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                      ✔️ {point}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 style={{ marginTop: 0, color: 'var(--color-warning)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <AlertTriangle size={16} /> Gaps & Points of Attention
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {reasoning.weakness_points?.map((point: string, idx: number) => (
                    <div key={idx} style={{ background: 'var(--color-surface-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                      ⚠️ {point}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-4)' }}>
              No detailed match analysis available yet.
            </div>
          )}
        </div>
      )}

      {/* Proposal & Cover Letter Section */}
      {primaryProposal && (
        <div style={{ position: 'relative', background: 'var(--color-surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-6)' }}>
          {regenerateProposalMutation.isPending && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(15, 23, 42, 0.88)', backdropFilter: 'blur(6px)',
              borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', zIndex: 20
            }}>
              <Sparkles size={36} color="var(--color-accent)" style={{ animation: 'spin 1.2s linear infinite' }} />
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text)' }}>
                Regenerating Tailored Proposal...
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: '420px', lineHeight: 1.5 }}>
                Generating new proposal following <strong style={{ color: 'var(--color-accent)' }}>proposal_template.md</strong> with your real projects and optimal bidding rate.
              </div>
            </div>
          )}

          {/* Header Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Generated Proposal
                {primaryProposal.is_edited && (
                  <span style={{ fontSize: '0.7rem', background: 'var(--color-warning)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>EDITED</span>
                )}
              </h2>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span>Tone: <strong style={{ color: 'var(--color-accent)', textTransform: 'capitalize' }}>{primaryProposal.tone || 'Professional'}</strong></span>
                <span>·</span>
                <span style={{
                  color: wordCount <= 175 ? 'var(--color-success)' : 'var(--color-warning)',
                  fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px'
                }}>
                  {wordCount <= 175 ? '✓' : '⚠️'} {wordCount} words ({charCount} chars)
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {/* Copy Full Submission Button */}
              <button
                onClick={handleCopyEverything}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: copiedEverything ? 'var(--color-success)' : 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: copiedEverything ? '#fff' : 'var(--color-text)',
                  padding: '8px 14px', borderRadius: 'var(--radius-md)',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  transition: 'all 0.15s',
                }}
                title="Copy Cover Letter and all Screening Answers formatted for Upwork"
              >
                {copiedEverything ? <Check size={15} /> : <Copy size={15} />}
                {copiedEverything ? 'All Copied!' : 'Copy All (Letter + Q&A)'}
              </button>

              {/* Regenerate Proposal Button */}
              <button
                onClick={() => regenerateProposalMutation.mutate()}
                disabled={regenerateProposalMutation.isPending}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                  color: 'var(--color-text)', padding: '8px 14px',
                  borderRadius: 'var(--radius-md)', cursor: regenerateProposalMutation.isPending ? 'not-allowed' : 'pointer',
                  fontSize: '0.85rem', fontWeight: 500, transition: 'all 0.15s',
                }}
                title="Regenerate a new AI proposal version"
              >
                <RotateCcw size={15} style={{ animation: regenerateProposalMutation.isPending ? 'spin 1s linear infinite' : 'none' }} />
                {regenerateProposalMutation.isPending ? 'Regenerating...' : 'Regenerate'}
              </button>

              {/* Copy Cover Letter Only Button */}
              <button
                onClick={handleCopyLetter}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: copiedLetter ? 'var(--color-success)' : 'var(--color-accent)',
                  color: 'white', border: 'none', padding: '8px 14px',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  transition: 'background 0.2s',
                }}
              >
                {copiedLetter ? <Check size={15} /> : <Copy size={15} />}
                {copiedLetter ? 'Copied!' : 'Copy Proposal'}
              </button>

              {/* Edit / Save Button */}
              {isEditingProposal ? (
                <>
                  <button onClick={() => setIsEditingProposal(false)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <X size={15} /> Cancel
                  </button>
                  <button
                    onClick={() => updateProposalMutation.mutate({ proposalId: primaryProposal.id, letter: editedLetter })}
                    disabled={updateProposalMutation.isPending}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--color-success)', border: 'none', color: 'white', padding: '8px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                    <Save size={15} /> {updateProposalMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setEditedLetter(primaryProposal.cover_letter); setIsEditingProposal(true); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '8px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <Edit3 size={15} /> Edit Text
                </button>
              )}
            </div>
          </div>

          {/* Textarea Container with Floating Quick-Copy Button */}
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', top: '10px', right: '10px', zIndex: 5
            }}>
              <button
                onClick={handleCopyLetter}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: copiedLetter ? 'var(--color-success)' : 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: copiedLetter ? '#fff' : 'var(--color-text)',
                  padding: '5px 12px', borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)', transition: 'all 0.15s'
                }}
                title="Copy proposal text from textarea"
              >
                {copiedLetter ? <Check size={14} /> : <Copy size={14} />}
                {copiedLetter ? 'Copied!' : 'Copy'}
              </button>
            </div>

            {isEditingProposal ? (
              <textarea
                value={editedLetter}
                onChange={e => setEditedLetter(e.target.value)}
                placeholder="Edit proposal cover letter..."
                style={{
                  width: '100%', minHeight: '340px', background: 'var(--color-bg)',
                  border: '1px solid var(--color-accent)', color: 'var(--color-text)',
                  padding: 'var(--space-4)', paddingRight: '90px', borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.6,
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
              />
            ) : (
              <textarea
                readOnly
                value={primaryProposal.cover_letter}
                onClick={e => (e.target as HTMLTextAreaElement).select()}
                style={{
                  width: '100%', minHeight: '340px', background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)', color: 'var(--color-text)',
                  padding: 'var(--space-4)', paddingRight: '90px', borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.7,
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box', cursor: 'text'
                }}
              />
            )}
          </div>

          {/* Clean Bid & Tone Header Strip */}
          {(primaryProposal.suggested_bid || primaryProposal.tone) && (
            <div style={{
              display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-4)',
              padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
              alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap'
            }}>
              {primaryProposal.suggested_bid && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    <DollarSign size={20} color="#10B981" />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Suggested Bid Rate
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10B981', lineHeight: 1.1 }}>
                      ${primaryProposal.suggested_bid}
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.8, marginLeft: '2px' }}>
                        {job.budget_type === 'Hourly' ? '/hr' : ' total'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '3px' }}>
                      Take-home: <strong style={{ color: 'var(--color-success)' }}>${(primaryProposal.suggested_bid * 0.9).toFixed(2)}{job.budget_type === 'Hourly' ? '/hr' : ''}</strong> (after 10% fee)
                    </div>
                  </div>
                </div>
              )}

              {primaryProposal.tone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: 'rgba(255, 107, 53, 0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    <Sparkles size={18} color="#FF6B35" />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Proposal Style
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#FF814F', textTransform: 'capitalize', lineHeight: 1.1 }}>
                      {primaryProposal.tone}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Uncluttered Milestone Roadmap & Timeline Card */}
          {primaryProposal.timeline && (() => {
            const rawParts = primaryProposal.timeline.split(/;|\\n/).map((s: string) => s.trim()).filter(Boolean);
            const isMultiStep = rawParts.length > 1 || /week|phase|step/i.test(primaryProposal.timeline);
            const steps = rawParts.map((part: string, idx: number) => {
              const match = part.match(/^(Week\s*\d+|Phase\s*\d+|Stage\s*\d+|Step\s*\d+|Sprint\s*\d+):\s*(.*)$/i);
              if (match) {
                return { title: match[1], description: match[2] };
              }
              return { title: `Phase ${idx + 1}`, description: part };
            });

            return (
              <div style={{
                marginTop: 'var(--space-4)', padding: 'var(--space-4)',
                background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-3)' }}>
                  <Clock size={16} color="var(--color-accent)" />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>
                    Estimated Timeline & Execution Roadmap
                  </span>
                </div>

                {isMultiStep ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-3)' }}>
                    {steps.map((step: { title: string; description: string }, idx: number) => (
                      <div key={idx} style={{
                        background: 'var(--color-bg)', padding: 'var(--space-3) var(--space-4)',
                        borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                        display: 'flex', flexDirection: 'column', gap: '4px'
                      }}>
                        <span style={{
                          fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)',
                          background: 'var(--color-accent-dim)', padding: '2px 8px', borderRadius: '10px',
                          width: 'fit-content'
                        }}>
                          {step.title}
                        </span>
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                          {step.description}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: 1.5, background: 'var(--color-bg)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)' }}>
                    {primaryProposal.timeline}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Screening Q&A Section */}
          {primaryProposal.screening_answers && primaryProposal.screening_answers.length > 0 && (
            <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-6)', borderTop: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Screening Questions & Answers</h3>
                <button
                  onClick={handleCopyAllQA}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text)', padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                  }}
                >
                  {copiedQA ? <Check size={14} color="var(--color-success)" /> : <Copy size={14} />}
                  {copiedQA ? 'All Copied!' : 'Copy All Q&As'}
                </button>
              </div>

              {primaryProposal.screening_answers.map((qa: ScreeningAnswer, index: number) => (
                <div key={index} style={{ marginBottom: 'var(--space-4)', background: 'var(--color-bg)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>Q: {qa.question}</span>
                    <button
                      onClick={() => handleCopySingleQ(qa.answer, index)}
                      style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      {copiedQIndex === index ? <Check size={13} color="var(--color-success)" /> : <Copy size={13} />}
                      {copiedQIndex === index ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>
                    {qa.answer}
                  </div>
                  {qa.requires_personal_input && (
                    <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertTriangle size={13} /> Requires personal input / portfolio link before submitting
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!primaryProposal && (
        <div style={{ background: 'var(--color-surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)', marginBottom: 'var(--space-6)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            {job.match_score != null && job.match_score >= 70
              ? 'Proposal generation is pending. Click below to generate a tailored proposal.'
              : `Match score (${job.match_score ?? 0}%) is below default threshold — click below to generate an AI proposal.`}
          </p>
          <button
            onClick={() => regenerateProposalMutation.mutate()}
            disabled={regenerateProposalMutation.isPending}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'var(--color-accent)', color: 'white', border: 'none',
              padding: '10px 20px', borderRadius: 'var(--radius-md)', cursor: regenerateProposalMutation.isPending ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: '0.9rem',
            }}
          >
            <Sparkles size={18} style={{ animation: regenerateProposalMutation.isPending ? 'spin 1s linear infinite' : 'none' }} />
            {regenerateProposalMutation.isPending ? 'Generating Proposal...' : '✨ Generate AI Proposal'}
          </button>
        </div>
      )}

      {/* Contextual AI Quick Prompts Footer */}
      <div style={{ background: 'var(--color-surface-2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
          <Sparkles size={16} color="var(--color-accent)" /> Quick AI Copilot Actions:
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleOpenChat(`Draft a 1-sentence punchy opening hook specifically for "${job.title}".`)}
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            ✨ Opening Hook for {job.title.length > 20 ? job.title.slice(0, 20) + '...' : job.title}
          </button>
          <button
            onClick={() => handleOpenChat(`Suggest 3 specific technical questions to ask the client about "${job.title}".`)}
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            ✨ 3 Tech Questions
          </button>
          <button
            onClick={() => handleOpenChat(`How can I justify a target rate of $${job.budget_max || 25}/hr for "${job.title}" based on my experience?`)}
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            ✨ Justify ${job.budget_max || 25}/hr Rate
          </button>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
