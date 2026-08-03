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
