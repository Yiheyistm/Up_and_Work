export type JobStatus = 'new' | 'shortlisted' | 'applied' | 'invited' | 'interviewing' | 'hired' | 'rejected' | 'ignored';

export interface MatchReasoning {
  match_score: number;
  skill_coverage: number;
  gap_skills: string[];
  strength_points: string[];
  weakness_points: string[];
  competition_level: 'Low' | 'Medium' | 'High';
  client_vibe: 'Professional' | 'Unclear' | 'Risky' | 'Excellent';
  urgency_score: number;
  recommended_bid: number;
  recommended_action: 'Apply Now' | 'Apply Later' | 'Skip';
}

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
  experience_level?: string;
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

export interface ScreeningAnswer {
  question: string;
  answer: string;
  requires_personal_input: boolean;
  confidence: 'High' | 'Medium' | 'Low';
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
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  message_metadata?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  job_id?: string;
  title: string;
  context_type: string;
  created_at: string;
  messages: ChatMessage[];
}

export interface JobTrackingEvent {
  id: string;
  job_id: string;
  event_type: string;
  note?: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface InviteNotification {
  id: string;
  job_id?: string;
  source: string;
  parsed_title?: string;
  summary?: string;
  raw_content?: string;
  invite_url?: string;
  notified_telegram?: boolean;
  notified_web?: boolean;
  created_at: string;
}
