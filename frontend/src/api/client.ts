import axios from 'axios';
import type { Job, JobStatus, ProposalDraft, ChatSession, ChatMessage } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8001/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const api = {
  // Jobs
  getJobs: async (status?: string, minScore?: number): Promise<Job[]> => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (minScore) params.append('min_score', minScore.toString());
    params.append('limit', '200');
    const { data } = await apiClient.get(`/jobs/?${params.toString()}`);
    return data;
  },
  getJob: async (id: string): Promise<Job> => {
    const { data } = await apiClient.get(`/jobs/${id}`);
    return data;
  },
  updateJobStatus: async (id: string, status: JobStatus): Promise<Job> => {
    const { data } = await apiClient.patch(`/jobs/${id}/status`, { status });
    return data;
  },
  deleteJob: async (id: string): Promise<void> => {
    await apiClient.delete(`/jobs/${id}`);
  },

  // Proposals
  getProposals: async (jobId: string): Promise<ProposalDraft[]> => {
    const { data } = await apiClient.get(`/proposals/job/${jobId}`);
    return data;
  },
  regenerateProposal: async (jobId: string): Promise<ProposalDraft> => {
    const { data } = await apiClient.post(`/proposals/job/${jobId}/regenerate`);
    return data;
  },

  // Chat
  getSessions: async (jobId?: string): Promise<ChatSession[]> => {
    const params = new URLSearchParams();
    if (jobId) params.append('job_id', jobId);
    const { data } = await apiClient.get(`/chat/sessions?${params.toString()}`);
    return data;
  },
  createSession: async (title: string, context_type: string = 'general', jobId?: string): Promise<ChatSession> => {
    const { data } = await apiClient.post(`/chat/sessions`, { title, context_type, job_id: jobId || null });
    return data;
  },
  updateSessionTitle: async (sessionId: string, title: string): Promise<ChatSession> => {
    const { data } = await apiClient.patch(`/chat/sessions/${sessionId}`, { title });
    return data;
  },
  deleteSession: async (sessionId: string): Promise<void> => {
    await apiClient.delete(`/chat/sessions/${sessionId}`);
  },
  getMessages: async (sessionId: string): Promise<ChatMessage[]> => {
    const { data } = await apiClient.get(`/chat/sessions/${sessionId}/messages`);
    return data;
  },
  sendMessage: async (sessionId: string, content: string, role: 'user' | 'assistant' = 'user'): Promise<ChatMessage> => {
    const { data } = await apiClient.post(`/chat/sessions/${sessionId}/messages`, { content, role });
    return data;
  },

  // System
  triggerScan: async (): Promise<any> => {
    const { data } = await apiClient.post(`/system/scan`);
    return data;
  },
  getSystemStatus: async (): Promise<any> => {
    const { data } = await apiClient.get('/system/status');
    return data;
  },
  testEmailConnection: async (): Promise<{ success: boolean; message: string }> => {
    const { data } = await apiClient.post('/system/test-email');
    return data;
  },

  // Profile
  getProfile: async (): Promise<any> => {
    const { data } = await apiClient.get('/profile/');
    return data;
  },
  updateProfile: async (profileData: any): Promise<any> => {
    const { data } = await apiClient.put('/profile/', profileData);
    return data;
  },
  exportProfile: async (): Promise<void> => {
    // Fetch as blob so the browser can trigger a native file download.
    const response = await apiClient.get('/profile/export', { responseType: 'blob' });
    const cd = response.headers['content-disposition'] ?? '';
    const match = cd.match(/filename="?([^";\s]+)"?/);
    const filename = match ? match[1] : 'upwork_profile.json';
    const url = URL.createObjectURL(new Blob([response.data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
  importProfile: async (file: File): Promise<any> => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.post('/profile/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  // Invites
  getInvites: async (): Promise<any[]> => {
    const { data } = await apiClient.get('/invites/');
    return data;
  },
  checkEmailInvites: async (): Promise<{ status: string; new_invites_found: number }> => {
    const { data } = await apiClient.post('/invites/check-email');
    return data;
  },
  markInviteRead: async (inviteId: string): Promise<any> => {
    const { data } = await apiClient.put(`/invites/${inviteId}/read`);
    return data;
  },
  markAllInvitesRead: async (): Promise<any> => {
    const { data } = await apiClient.put('/invites/read-all');
    return data;
  },
  deleteInvite: async (inviteId: string): Promise<void> => {
    await apiClient.delete(`/invites/${inviteId}`);
  },
};
