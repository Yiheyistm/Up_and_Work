---
name: upwork_frontend_patterns
description: >
  Patterns and conventions for the Up_and_Work React/Vite frontend.
  Triggers when: building or modifying any frontend page or component,
  working with WebSockets on the frontend, managing state, or styling
  the dashboard in this project.
---

# Up_and_Work — Frontend Patterns Skill

## Stack
- **Vite + React 18 + TypeScript** (strict mode)
- **React Router v6** for routing
- **TanStack Query (React Query)** for API data
- **Zustand** for global state (scheduler status, notification count, active chat)
- **WebSocket** native browser API (custom hook `useWebSocket`)

## Design System (CSS Variables — `src/index.css`)
```css
:root {
  /* Colors */
  --color-bg: #0a0a0f;
  --color-surface: #111118;
  --color-surface-2: #1a1a24;
  --color-border: #2a2a38;
  --color-accent: #6c63ff;
  --color-accent-hover: #7d75ff;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-text: #e8e8f0;
  --color-text-muted: #888899;

  /* Score colors */
  --score-high: #22c55e;    /* >= 80 */
  --score-mid: #f59e0b;     /* 60-79 */
  --score-low: #ef4444;     /* < 60 */

  /* Spacing */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;

  /* Border radius */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;

  /* Typography */
  --font-sans: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

## API Client (`src/api/`)
One typed function per endpoint. Never use raw `fetch` in components.
```typescript
// src/api/jobs.ts
import { Job, JobsResponse } from '../types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export async function fetchJobs(status?: string, minScore?: number): Promise<JobsResponse> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (minScore) params.set('min_score', String(minScore));
  const res = await fetch(`${BASE}/jobs?${params}`);
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export async function updateJobStatus(jobId: string, status: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}
```

## WebSocket Hook (`src/hooks/useWebSocket.ts`)
```typescript
import { useEffect, useRef, useCallback } from 'react';

export function useWebSocket(url: string, onMessage: (data: unknown) => void) {
  const ws = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    ws.current = new WebSocket(url);
    ws.current.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.current.onclose = () => setTimeout(connect, 3000); // auto-reconnect
    ws.current.onerror = () => ws.current?.close();
  }, [url, onMessage]);

  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, [connect]);
}
```

## Zustand Store (`src/store/appStore.ts`)
```typescript
import { create } from 'zustand';

interface AppState {
  schedulerRunning: boolean;
  unreadCount: number;
  activeChatSessionId: string | null;
  setSchedulerRunning: (v: boolean) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
  setActiveChat: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  schedulerRunning: true,
  unreadCount: 0,
  activeChatSessionId: null,
  setSchedulerRunning: (v) => set({ schedulerRunning: v }),
  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  clearUnread: () => set({ unreadCount: 0 }),
  setActiveChat: (id) => set({ activeChatSessionId: id }),
}));
```

## TypeScript Types (`src/types/index.ts`)
Mirror backend Pydantic schemas exactly:
```typescript
export type JobStatus = 'new' | 'shortlisted' | 'applied' | 'invited' | 'interviewing' | 'hired' | 'rejected' | 'ignored';

export interface Job {
  id: string;
  guid: string;
  title: string;
  description: string;
  link: string;
  domain?: string;
  budget_type?: string;
  budget_min?: number;
  budget_max?: number;
  client_rating?: number;
  client_country?: string;
  payment_verified: boolean;
  required_skills: string[];
  red_flags: string[];
  match_score?: number;
  reasoning?: MatchReasoning;
  status: JobStatus;
  posted_at?: string;
  detected_at: string;
}

export interface ProposalDraft {
  id: string;
  job_id: string;
  cover_letter: string;
  screening_answers: ScreeningAnswer[];
  suggested_bid: number;
  timeline: string;
  tone: string;
  version: number;
  is_edited: boolean;
  edited_content?: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
```

## Routing (`src/App.tsx`)
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/tracker" element={<Tracker />} />
        <Route path="/chat" element={<AiChat />} />
        <Route path="/chat/:sessionId" element={<AiChat />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
```

## Score Badge Component
```tsx
function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'var(--score-high)' : score >= 60 ? 'var(--score-mid)' : 'var(--score-low)';
  const emoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
  return (
    <span style={{ color, fontWeight: 700, fontSize: '0.9rem' }}>
      {emoji} {score}%
    </span>
  );
}
```

## Environment Variables (Frontend)
```
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_WS_URL=ws://localhost:8000
```

## Key Conventions
- All pages have a `<title>` via `document.title` or react-helmet.
- All interactive elements have unique `id` attributes.
- Loading states use skeleton loaders (not spinners) for job cards.
- Error states show a dismissable inline error banner, not a full page.
- The sidebar is always visible; active route is highlighted.
