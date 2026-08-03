import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Mail, ExternalLink, RefreshCw, CheckCheck, Trash2, Bell, Sparkles, Clock, ChevronUp, Eye } from 'lucide-react';
import type { InviteNotification } from '../types';

/**
 * Use the browser's built-in DOMParser to extract clean readable plain text
 * from raw HTML email content. Strips all tags, scripts, styles and image
 * alt/src garbage reliably — regex cannot handle malformed multiline HTML.
 */
function htmlToText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Remove script, style, and img tags entirely
    doc.querySelectorAll('script, style, img, head').forEach(el => el.remove());
    // Replace <br>, <p>, <div>, <tr>, <li> with newlines for readability
    doc.querySelectorAll('br, p, div, tr, li, h1, h2, h3, h4, h5, h6').forEach(el => {
      el.insertAdjacentText('afterend', '\n');
    });
    const text = doc.body?.innerText ?? doc.body?.textContent ?? '';
    return text
      .replace(/[ \t]{2,}/g, ' ')       // collapse horizontal whitespace
      .replace(/\n{3,}/g, '\n\n')       // collapse excess blank lines
      .trim();
  } catch {
    return html.replace(/<[^>]*>/g, ' ').trim();
  }
}

export default function Invites() {
  const queryClient = useQueryClient();
  const [filterSource, setFilterSource] = useState<string>('all');
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [checkStatusMsg, setCheckStatusMsg] = useState<string | null>(null);
  const [expandedInviteId, setExpandedInviteId] = useState<string | null>(null);

  const { data: invites, isLoading } = useQuery<InviteNotification[]>({
    queryKey: ['invites'],
    queryFn: () => api.getInvites(),
    refetchInterval: 30_000,
  });

  const checkEmailMutation = useMutation({
    mutationFn: () => api.checkEmailInvites(),
    onMutate: () => {
      setIsCheckingEmail(true);
      setCheckStatusMsg(null);
    },
    onSuccess: (data) => {
      setIsCheckingEmail(false);
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      setCheckStatusMsg(`Found ${data.new_invites_found} new Upwork email notification(s)!`);
      setTimeout(() => setCheckStatusMsg(null), 4000);
    },
    onError: () => {
      setIsCheckingEmail(false);
      setCheckStatusMsg('Email check complete. Make sure IMAP credentials are set in .env.');
      setTimeout(() => setCheckStatusMsg(null), 4000);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markInviteRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllInvitesRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });

  const deleteInviteMutation = useMutation({
    mutationFn: (id: string) => api.deleteInvite(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });

  const handleToggleExpand = (invite: InviteNotification) => {
    const isExpanding = expandedInviteId !== invite.id;
    setExpandedInviteId(isExpanding ? invite.id : null);

    if (isExpanding && !invite.notified_web) {
      markReadMutation.mutate(invite.id);
    }
  };

  const sourceEmoji: Record<string, string> = {
    invitation: '🎉',
    message: '💬',
    offer: '💼',
    email: '📧',
  };

  const filteredInvites = invites?.filter(inv => {
    if (filterSource === 'all') return true;
    return inv.source.toLowerCase() === filterSource.toLowerCase();
  }) ?? [];

  const unreadCount = invites?.filter(i => !i.notified_web).length ?? 0;

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Top Banner Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '46px', height: '46px', borderRadius: '12px',
            background: 'rgba(255, 107, 53, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Mail size={26} color="var(--color-accent)" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', lineHeight: 1.2 }}>Upwork Invites & Direct Messages</h1>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Real-time IMAP email inbox monitor detecting job invitations, direct client messages, and formal offers.
            </div>
          </div>
        </div>

        {/* Action Header Buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button
            onClick={() => checkEmailMutation.mutate()}
            disabled={isCheckingEmail}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'var(--color-accent)', color: '#fff', border: 'none',
              padding: '10px 16px', borderRadius: 'var(--radius-md)',
              fontWeight: 600, fontSize: '0.88rem', cursor: isCheckingEmail ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(255, 107, 53, 0.3)', transition: 'all 0.15s'
            }}
          >
            <RefreshCw size={16} style={{ animation: isCheckingEmail ? 'spin 1s linear infinite' : 'none' }} />
            {isCheckingEmail ? 'Checking Email Inbox...' : 'Check Email Now'}
          </button>

          {invites && invites.length > 0 && (
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending || unreadCount === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                color: unreadCount > 0 ? 'var(--color-text)' : 'var(--color-text-muted)',
                padding: '10px 14px', borderRadius: 'var(--radius-md)',
                fontSize: '0.85rem', fontWeight: 500, cursor: unreadCount > 0 ? 'pointer' : 'default',
              }}
            >
              <CheckCheck size={16} /> Mark All Read
            </button>
          )}
        </div>
      </div>

      {/* Check Status Feedback Toast Strip */}
      {checkStatusMsg && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--color-success)',
          color: 'var(--color-success)', padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)',
          fontSize: '0.88rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <Sparkles size={16} /> {checkStatusMsg}
        </div>
      )}

      {/* Source Filter Pills Bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { key: 'all', label: 'All Notifications', count: invites?.length ?? 0 },
          { key: 'invitation', label: '🎉 Invitations', count: invites?.filter(i => i.source.toLowerCase() === 'invitation').length ?? 0 },
          { key: 'message', label: '💬 Messages', count: invites?.filter(i => i.source.toLowerCase() === 'message').length ?? 0 },
          { key: 'offer', label: '💼 Offers', count: invites?.filter(i => i.source.toLowerCase() === 'offer').length ?? 0 },
        ].map(filter => {
          const isSelected = filterSource === filter.key;
          return (
            <button
              key={filter.key}
              onClick={() => setFilterSource(filter.key)}
              style={{
                padding: '6px 14px', borderRadius: '20px',
                border: isSelected ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: isSelected ? 'var(--color-accent)' : 'var(--color-surface)',
                color: isSelected ? '#fff' : 'var(--color-text-muted)',
                fontWeight: isSelected ? 600 : 400, fontSize: '0.8rem', cursor: 'pointer',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              {filter.label}
              <span style={{
                fontSize: '0.72rem', background: isSelected ? 'rgba(255,255,255,0.25)' : 'var(--color-surface-2)',
                padding: '1px 6px', borderRadius: '10px'
              }}>
                {filter.count}
              </span>
            </button>
          );
        })}

        {unreadCount > 0 && (
          <span style={{
            marginLeft: 'auto', fontSize: '0.78rem', fontWeight: 700, color: '#3B82F6',
            background: 'rgba(59, 130, 246, 0.15)', padding: '4px 10px', borderRadius: '12px',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}>
            <Bell size={13} /> {unreadCount} Unread
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ background: 'var(--color-surface)', padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
          Loading email notifications...
        </div>
      ) : filteredInvites.length === 0 ? (
        <div style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)',
          border: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)'
        }}>
          <Mail size={48} style={{ opacity: 0.2, color: 'var(--color-accent)' }} />
          <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: '1.1rem' }}>No Invites or Messages Detected Yet</div>
          <p style={{ fontSize: '0.88rem', maxWidth: '480px', margin: 0, lineHeight: 1.5 }}>
            Upwork automated emails sent from <strong style={{ color: 'var(--color-accent)' }}>donotreply@upwork.com</strong> to your configured IMAP inbox will appear here automatically within 2 minutes of receipt.
          </p>
          <button
            onClick={() => checkEmailMutation.mutate()}
            disabled={isCheckingEmail}
            style={{
              marginTop: 'var(--space-2)', background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)', color: 'var(--color-text)',
              padding: '8px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <RefreshCw size={14} style={{ animation: isCheckingEmail ? 'spin 1s linear infinite' : 'none' }} />
            Trigger Instant Inbox Scan
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filteredInvites.map(invite => {
            const isUnread = !invite.notified_web;
            const isExpanded = expandedInviteId === invite.id;

            return (
              <div
                key={invite.id}
                style={{
                  background: 'var(--color-surface)',
                  border: isExpanded ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                  borderLeft: isUnread ? '4px solid #3B82F6' : isExpanded ? '4px solid var(--color-accent)' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4) var(--space-5)',
                  display: 'flex', flexDirection: 'column',
                  gap: 'var(--space-3)',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                  <div
                    onClick={() => handleToggleExpand(invite)}
                    style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flex: 1, minWidth: '260px', cursor: 'pointer' }}
                  >
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '10px',
                      background: 'var(--color-surface-2)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0
                    }}>
                      {sourceEmoji[invite.source.toLowerCase()] ?? '📧'}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text)' }}>
                          {invite.parsed_title || 'Upwork Notification'}
                        </span>
                        {isUnread && (
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 600, color: '#60A5FA',
                            background: 'rgba(59, 130, 246, 0.15)', padding: '2px 8px', borderRadius: '12px',
                            display: 'inline-flex', alignItems: 'center', gap: '4px'
                          }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3B82F6' }} />
                            Unread
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ textTransform: 'capitalize', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                          {invite.source}
                        </span>
                        <span>·</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <Clock size={12} /> {new Date(invite.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                    <button
                      onClick={() => handleToggleExpand(invite)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        background: isExpanded ? 'var(--color-accent)' : 'var(--color-surface-2)',
                        border: '1px solid var(--color-border)',
                        color: isExpanded ? '#fff' : 'var(--color-text)',
                        padding: '8px 12px', borderRadius: 'var(--radius-md)',
                        fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                      }}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <Eye size={14} />}
                      {isExpanded ? 'Collapse' : 'Read Message'}
                    </button>

                    {invite.invite_url && (
                      <a
                        href={invite.invite_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => markReadMutation.mutate(invite.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px',
                          background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                          color: 'var(--color-text)', padding: '8px 14px', borderRadius: 'var(--radius-md)',
                          fontSize: '0.85rem', fontWeight: 500, textDecoration: 'none', transition: 'all 0.15s'
                        }}
                        onMouseOver={e => {
                          e.currentTarget.style.borderColor = '#10B981';
                          e.currentTarget.style.color = '#10B981';
                        }}
                        onMouseOut={e => {
                          e.currentTarget.style.borderColor = 'var(--color-border)';
                          e.currentTarget.style.color = 'var(--color-text)';
                        }}
                      >
                        <ExternalLink size={14} color="#10B981" /> Open Upwork
                      </a>
                    )}

                    <button
                      onClick={() => {
                        if (confirm('Delete this notification?')) {
                          deleteInviteMutation.mutate(invite.id);
                        }
                      }}
                      style={{
                        background: 'transparent', border: '1px solid var(--color-border)',
                        color: 'var(--color-danger)', padding: '8px 10px', borderRadius: 'var(--radius-md)',
                        cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center'
                      }}
                      title="Delete notification"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Inline Full Message Body Reader Viewer */}
                {isExpanded && (
                  <div style={{
                    width: '100%', marginTop: 'var(--space-2)', paddingTop: 'var(--space-3)',
                    borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)'
                  }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      📬 Full Message Content
                    </div>
                    <div style={{
                      background: 'var(--color-surface-2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)', maxHeight: '420px', overflowY: 'auto',
                      color: 'var(--color-text)', fontSize: '0.9rem', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                    }}>
                      {invite.raw_content
                        ? htmlToText(invite.raw_content)
                        : invite.summary || 'No message content available.'
                      }
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer Info Box */}
      <div style={{
        marginTop: 'var(--space-8)', padding: 'var(--space-4)', background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
        fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5
      }}>
        💡 <strong style={{ color: 'var(--color-text)' }}>How Email Invites Monitor Works:</strong> Up_and_Work connects securely to your email inbox via IMAP (configured in <code style={{ color: 'var(--color-accent)' }}>.env</code> via <code style={{ color: 'var(--color-accent)' }}>IMAP_EMAIL</code>). Whenever an official email arrives from Upwork, the monitor extracts the invitation link, notifies your Telegram bot within 2 minutes, and posts it to this board.
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .email-body-content, .email-body-content * {
          color: var(--color-text) !important;
          background: transparent !important;
          max-width: 100% !important;
          font-family: inherit !important;
        }
        .email-body-content a {
          color: var(--color-accent) !important;
          text-decoration: underline !important;
        }
      `}</style>
    </div>
  );
}
