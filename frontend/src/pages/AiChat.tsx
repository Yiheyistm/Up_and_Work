import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAppStore } from '../store/appStore';
import { Send, Bot, User, Plus, Loader, X, MessageSquare, Edit3, Trash2, Copy, Check, Sparkles, Square } from 'lucide-react';
import type { ChatSession, ChatMessage } from '../types';
import ReactMarkdown from 'react-markdown';

export default function AiChat() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const autoPrompt = (location.state as any)?.autoPrompt;

  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [optimisticMsg, setOptimisticMsg] = useState<{ content: string; sentAt: string } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const activeSessionId = useAppStore(s => s.activeChatSessionId);
  const setActiveChat = useAppStore(s => s.setActiveChat);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const pendingAutoPromptRef = useRef<string | null>(autoPrompt ?? null);

  const { data: sessions, isLoading: sessionsLoading } = useQuery<ChatSession[]>({
    queryKey: ['chatSessions'],
    queryFn: () => api.getSessions(),
  });

  const { data: messages, refetch: refetchMessages } = useQuery<ChatMessage[]>({
    queryKey: ['chatMessages', activeSessionId],
    queryFn: () => activeSessionId ? api.getMessages(activeSessionId) : Promise.resolve([]),
    enabled: !!activeSessionId,
  });

  useEffect(() => {
    if (!sessionsLoading && sessions && sessions.length === 0 && !activeSessionId) {
      api.createSession('AI Assistant', 'general').then(session => {
        queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
        setActiveChat(session.id);
      });
    } else if (sessions && sessions.length > 0 && !activeSessionId) {
      setActiveChat(sessions[0].id);
    }
  }, [sessions, sessionsLoading, activeSessionId, setActiveChat, queryClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    if (!activeSessionId) return;

    // Fresh lifecycle for this session — clear per-session UI state.
    setOptimisticMsg(null);
    setErrorBanner(null);
    unmountedRef.current = false;
    intentionalCloseRef.current = false;

    // Deliberately swap sockets when switching sessions: suppress the old
    // socket's onclose so it cannot schedule a reconnect.
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      const old = wsRef.current;
      old.onclose = null;
      old.onerror = null;
      if (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING) {
        old.close();
      }
      wsRef.current = null;
    }

    const connectSocket = () => {
      if (!activeSessionId || unmountedRef.current) return;

      const token = localStorage.getItem('upw_token') ?? '';
      const ws = new WebSocket(`${import.meta.env.VITE_WS_URL || 'ws://localhost:8001'}/ws/chat/${activeSessionId}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send a pending autoPrompt (from location.state) on every successful
        // open until it has been delivered once.
        if (pendingAutoPromptRef.current) {
          setIsStreaming(true);
          setStreamingText('');
          ws.send(JSON.stringify({ content: pendingAutoPromptRef.current }));
          pendingAutoPromptRef.current = null;
          window.history.replaceState({}, document.title);
        }
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.event === 'ping') return;

          if (data.type === 'error') {
            setIsStreaming(false);
            setStreamingText('');
            setOptimisticMsg(null);
            setErrorBanner(data.message ?? 'Something went wrong.');
            return;
          }

          if (!data.done) {
            setStreamingText(prev => prev + (data.chunk ?? ''));
          } else {
            setStreamingText('');
            setIsStreaming(false);
            setOptimisticMsg(null);
            refetchMessages();
          }
        } catch {
          setStreamingText(prev => prev + e.data);
        }
      };

      ws.onerror = () => {
        setIsStreaming(false);
        setStreamingText('');
      };

      ws.onclose = () => {
        if (intentionalCloseRef.current || unmountedRef.current) return;
        // Unexpected drop — reset streaming state so the UI never stays stuck.
        setIsStreaming(false);
        setStreamingText('');
        setOptimisticMsg(null);
        refetchMessages();
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connectSocket, 3000);
      };
    };

    connectSocket();

    return () => {
      unmountedRef.current = true;
      intentionalCloseRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeSessionId, refetchMessages]);

  const titleUpdated = useRef<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeSessionId && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeSessionId]);

  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editedMsgText, setEditedMsgText] = useState('');

  const handleCopyMessage = (msgId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const handleSendPrompt = (promptText: string) => {
    if (isStreaming || !wsRef.current || !activeSessionId) return;
    const content = promptText.trim();
    if (!content) return;
    setInput('');
    setErrorBanner(null);
    setIsStreaming(true);
    setStreamingText('');
    setOptimisticMsg({ content, sentAt: new Date().toISOString() });

    if (!titleUpdated.current.has(activeSessionId)) {
      titleUpdated.current.add(activeSessionId);
      const title = content.length > 50 ? content.slice(0, 50) + '...' : content;
      api.updateSessionTitle(activeSessionId, title).then(() => {
        queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      }).catch(() => {});
    }

    wsRef.current.send(JSON.stringify({ content }));
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || !activeSessionId || isStreaming || !wsRef.current) return;

    setInput("");
    setErrorBanner(null);
    setIsStreaming(true);
    setStreamingText("");
    setOptimisticMsg({ content, sentAt: new Date().toISOString() });

    if (!titleUpdated.current.has(activeSessionId)) {
      titleUpdated.current.add(activeSessionId);
      const title = content.length > 50 ? content.slice(0, 50) + '...' : content;
      try {
        await api.updateSessionTitle(activeSessionId, title);
        queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      } catch {
        // Silently fail — title update is optional
      }
    }

    wsRef.current.send(JSON.stringify({ content }));
  };

  const handleStop = () => {
    // Ask the backend to cancel the in-flight generation (if the socket is up).
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }));
    }
    // Reset optimistically so the UI feels responsive; the backend's done
    // frame (or onclose) will settle any remaining state.
    setIsStreaming(false);
    setStreamingText('');
  };

  const createSessionMutation = useMutation({
    mutationFn: () => api.createSession('New Chat', 'general'),
    onSuccess: (session) => {
      setActiveChat(session.id);
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      api.updateSessionTitle(sessionId, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      if (activeSessionId && !sessions?.find(s => s.id === activeSessionId)) {
        setActiveChat(null);
      }
    },
  });

  const handleRenameSession = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTitle = prompt('Enter new conversation title:', session.title);
    if (newTitle && newTitle.trim() && newTitle.trim() !== session.title) {
      updateTitleMutation.mutate({ sessionId: session.id, title: newTitle.trim() });
    }
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      deleteSessionMutation.mutate(sessionId);
    }
  };

  return (
    <div className="ai-chat-root" style={{ display: 'flex', background: 'var(--color-bg)' }}>
      {/* Mobile backdrop overlay for chat conversations sidebar */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 99,
          }}
          className="chat-overlay"
        />
      )}

      {/* Sessions Sidebar */}
      <div style={{
        width: '280px',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        top: 0,
        bottom: 0,
        transition: 'left 0.2s ease',
        boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,0.5)' : 'none',
      }}
      className={sidebarOpen ? 'chat-sidebar chat-sidebar-open' : 'chat-sidebar'}
      >
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Conversations</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {sidebarOpen && (
              <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}>
                <X size={16} />
              </button>
            )}
            <button
              onClick={() => createSessionMutation.mutate()}
              style={{ background: 'var(--color-accent)', color: 'white', border: 'none', padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
            >
              <Plus size={14} /> New
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>
          {sessions?.map(session => (
            <div
              key={session.id}
              style={{
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: activeSessionId === session.id ? 'var(--color-surface-2)' : 'transparent',
                color: activeSessionId === session.id ? 'var(--color-text)' : 'var(--color-text-muted)',
                marginBottom: 'var(--space-1)',
                fontSize: '0.9rem',
                transition: 'background 0.15s',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}
              onClick={() => {
                setActiveChat(session.id);
                setSidebarOpen(false);
              }}
              onMouseOver={(e) => {
                if (activeSessionId !== session.id) e.currentTarget.style.background = 'var(--color-surface-2)';
              }}
              onMouseOut={(e) => {
                if (activeSessionId !== session.id) e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: activeSessionId === session.id ? 600 : 400, marginBottom: '2px', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {session.title}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {new Date(session.created_at).toLocaleDateString()}
                </div>
              </div>

              {/* Action Buttons: Rename Title & Delete */}
              <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={(e) => handleRenameSession(session, e)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--color-text-muted)',
                    cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center',
                    transition: 'color 0.15s',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.color = 'var(--color-accent)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                  title="Rename conversation"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={(e) => handleDeleteSession(session.id, e)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--color-text-muted)',
                    cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center',
                    transition: 'color 0.15s',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.color = 'var(--color-danger)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                  title="Delete conversation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {(!sessions || sessions.length === 0) && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 'var(--space-6)' }}>
              No conversations yet. Click "+ New" to start.
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Chat Top Header */}
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '52px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                className="chat-menu-btn"
              >
                <MessageSquare size={15} />
                <span>Conversations</span>
              </button>
            )}
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text)' }}>
              {sessions?.find(s => s.id === activeSessionId)?.title || 'AI Assistant'}
            </span>
          </div>
        </div>

        {!activeSessionId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--space-4)', color: 'var(--color-text-muted)' }}>
            <Bot size={48} style={{ opacity: 0.3 }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 600 }}>No conversation selected</p>
              <p style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>Pick one on the left or start a new one</p>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {messages?.map(msg => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex', gap: 'var(--space-3)',
                    maxWidth: '100%',
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  {msg.role === 'assistant' && (
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Bot size={16} color="white" />
                    </div>
                  )}
                  <div style={{
                    position: 'relative',
                    background: 'var(--color-surface-2)',
                    border: msg.role === 'user' ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    lineHeight: 1.6, fontSize: '0.9rem',
                    color: 'var(--color-text)',
                    wordBreak: 'break-word',
                  }}>
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => handleCopyMessage(msg.id, msg.content)}
                        style={{
                          position: 'absolute', top: '8px', right: '8px',
                          background: copiedMsgId === msg.id ? 'var(--color-success)' : 'var(--color-bg)',
                          border: '1px solid var(--color-border)',
                          color: copiedMsgId === msg.id ? '#fff' : 'var(--color-text-muted)',
                          padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.2)', transition: 'all 0.15s'
                        }}
                        title="Copy message content"
                      >
                        {copiedMsgId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedMsgId === msg.id ? 'Copied' : 'Copy'}
                      </button>
                    )}
                    {msg.role === 'assistant' ? (
                      <div style={{ paddingRight: '45px' }}>
                        <ReactMarkdown
                          components={{
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>{children}</a>
                            ),
                            code: ({ className, children, ...props }) => (
                              <code style={{ background: 'var(--color-bg)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }} {...props}>{children}</code>
                            ),
                            strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
                            em: ({ children }) => <em>{children}</em>,
                            ul: ({ children }) => <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>{children}</ul>,
                            ol: ({ children }) => <ol style={{ paddingLeft: '20px', margin: '8px 0' }}>{children}</ol>,
                            li: ({ children }) => <li style={{ marginBottom: '4px' }}>{children}</li>,
                            p: ({ children }) => <p style={{ margin: '8px 0' }}>{children}</p>,
                          }}
                        >{msg.content}</ReactMarkdown>
                      </div>
                    ) : editingMsgId === msg.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '280px' }}>
                        <textarea
                          value={editedMsgText}
                          onChange={e => setEditedMsgText(e.target.value)}
                          style={{
                            background: 'var(--color-bg)', border: '1px solid var(--color-accent)',
                            color: 'var(--color-text)', padding: '10px 12px', borderRadius: '8px',
                            fontSize: '0.9rem', fontFamily: 'inherit', resize: 'vertical', minHeight: '70px', outline: 'none',
                          }}
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => setEditingMsgId(null)}
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500 }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const text = editedMsgText.trim();
                              setEditingMsgId(null);
                              if (text) handleSendPrompt(text);
                            }}
                            style={{ background: 'var(--color-accent)', border: 'none', color: '#ffffff', padding: '4px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}
                          >
                            Save & Resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--color-text)' }}>{msg.content}</span>
                        <button
                          onClick={() => {
                            setEditingMsgId(msg.id);
                            setEditedMsgText(msg.content);
                          }}
                          style={{
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)',
                            cursor: 'pointer', padding: '3px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px',
                            fontSize: '0.72rem', fontWeight: 500, transition: 'all 0.15s'
                          }}
                          title="Edit message prompt"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>
                      </div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <User size={16} />
                    </div>
                  )}
                </div>
              ))}

              {/* Optimistic user bubble — shown until the persisted message is refetched */}
              {optimisticMsg && (
                <div style={{ display: 'flex', gap: 'var(--space-3)', maxWidth: '100%', alignSelf: 'flex-end' }}>
                  <div style={{
                    position: 'relative',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-accent)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: '16px 16px 4px 16px',
                    lineHeight: 1.6, fontSize: '0.9rem',
                    color: 'var(--color-text)',
                    wordBreak: 'break-word',
                  }}>
                    {optimisticMsg.content}
                  </div>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <User size={16} />
                  </div>
                </div>
              )}

              {/* Streaming bubble */}
              {isStreaming && (
                <div style={{ display: 'flex', gap: 'var(--space-3)', maxWidth: '100%', alignSelf: 'flex-start' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Bot size={16} color="white" />
                  </div>
                  <div style={{ background: 'var(--color-surface-2)', padding: 'var(--space-3) var(--space-4)', borderRadius: '16px 16px 16px 4px', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.9rem', minWidth: '40px' }}>
                    {streamingText || <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                    {streamingText && <span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompts & Input Area */}
            <div className="ai-chat-input" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', padding: 'var(--space-3)' }}>
              {/* Creative Categorized Strategy Chips */}
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: 'var(--space-3)', paddingBottom: '4px', scrollbarWidth: 'none' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, paddingRight: '4px' }}>
                  <Sparkles size={14} color="var(--color-accent)" /> AI Tactics:
                </span>
                {[
                  {
                    label: '🎯 1-Sentence Power Opener',
                    prompt: 'Write a punchy, 1-sentence opening hook addressing the client\'s core problem directly without generic filler words.',
                    badgeColor: '#3B82F6',
                  },
                  {
                    label: '❓ 3 Deep Tech Questions',
                    prompt: 'Suggest 3 specific, insightful technical questions to ask the client about their project to show deep architectural expertise.',
                    badgeColor: '#8B5CF6',
                  },
                  {
                    label: '💳 Pitch Bayment FinTech App',
                    prompt: 'Integrate my production Flutter + Django REST FinTech platform "Bayment" (deployed on Google Play) into this proposal as proof of relevant work.',
                    badgeColor: '#10B981',
                  },
                  {
                    label: '⚡ Ultra-Short Blitz (<120 Words)',
                    prompt: 'Rewrite the proposal to be under 120 words total — direct, high-impact, and conversational.',
                    badgeColor: '#F59E0B',
                  },
                  {
                    label: '💰 Justify High-Value Rate',
                    prompt: 'Explain how my experience with Clean Architecture, microservices in Go, and live production app releases justifies my bidding rate.',
                    badgeColor: '#EC4899',
                  },
                  {
                    label: '🛠️ Propose 3-Step Roadmap',
                    prompt: 'Outline a clear 3-step execution plan (Phase 1: Architecture, Phase 2: Core APIs & Features, Phase 3: QA & Production Release) for this project.',
                    badgeColor: '#06B6D4',
                  },
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendPrompt(chip.prompt)}
                    disabled={isStreaming}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                      padding: '5px 12px',
                      borderRadius: '20px',
                      fontSize: '0.78rem',
                      fontWeight: 500,
                      cursor: isStreaming ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'transform 0.15s, border-color 0.15s, background 0.15s',
                    }}
                    onMouseOver={e => {
                      e.currentTarget.style.borderColor = chip.badgeColor;
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: chip.badgeColor }} />
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Inline error banner — dismissible, cleared on next send */}
              {errorBanner && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
                  background: 'rgba(239,68,68,0.12)', border: '1px solid var(--color-danger)',
                  color: 'var(--color-danger)', padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)',
                  fontSize: '0.85rem', animation: 'fadeIn 0.2s ease',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, wordBreak: 'break-word' }}>
                    {errorBanner}
                  </span>
                  <button
                    onClick={() => setErrorBanner(null)}
                    title="Dismiss"
                    style={{
                      background: 'none', border: 'none', color: 'var(--color-danger)',
                      cursor: 'pointer', padding: '2px', flexShrink: 0,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <form
                onSubmit={e => { e.preventDefault(); handleSend(); }}
                style={{ display: 'flex', gap: 'var(--space-2)' }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={isStreaming ? 'Gemini is thinking...' : 'Ask Gemini to refine the proposal, suggest a bid...'}
                  disabled={isStreaming}
                  style={{
                    flex: 1, background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    padding: '12px 16px', borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text)', outline: 'none', fontSize: '0.9rem',
                    minWidth: 0,
                  }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isStreaming}
                  style={{
                    background: input.trim() && !isStreaming ? 'var(--color-accent)' : 'var(--color-surface-2)',
                    color: 'white', border: 'none', padding: '0 20px',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px', transition: 'background 0.2s',
                    flexShrink: 0,
                  }}
                >
                  {isStreaming ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={18} />}
                </button>
                {isStreaming && (
                  <button
                    type="button"
                    onClick={handleStop}
                    title="Stop generating"
                    style={{
                      background: 'var(--color-surface-2)', color: 'var(--color-text)',
                      border: '1px solid var(--color-border)', padding: '0 14px',
                      borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '6px',
                      transition: 'border-color 0.15s, color 0.15s', flexShrink: 0,
                      fontSize: '0.8rem', fontWeight: 500,
                    }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--color-danger)'; e.currentTarget.style.color = 'var(--color-danger)'; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text)'; }}
                  >
                    <Square size={14} />
                    Stop
                  </button>
                )}
              </form>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
