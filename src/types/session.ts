export type CloudTheme = 'editorial' | 'cobalt' | 'botanical' | 'obsidian';

export type CaseMode = 'title' | 'lower' | 'original';

export interface WordResponse {
  id: string;
  text: string;
  participantName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface EmailRecord {
  id: string;
  recipient: string;
  subject: string;
  responseCount: number;
  sentAt: number;
  method: 'gmail' | 'eml';
}

export interface AggregatedWord {
  key: string;
  text: string;
  count: number;
  lastSubmittedAt: number;
}

export interface WordCloudSession {
  code: string;
  title: string;
  question: string;
  organizerEmail: string;
  theme: CloudTheme;
  caseMode: CaseMode;
  allowMultiple: boolean;
  askName: boolean;
  isLocked: boolean;
  createdAt: number;
  expiresAt: number;
  lastClearedAt: number | null;
  responses: WordResponse[];
  words: AggregatedWord[];
  emailHistory: EmailRecord[];
}

export interface CreateSessionInput {
  title?: string;
  question?: string;
  organizerEmail?: string;
  theme?: CloudTheme;
  caseMode?: CaseMode;
  allowMultiple?: boolean;
  askName?: boolean;
}

export interface UpdateSessionInput {
  title?: string;
  question?: string;
  organizerEmail?: string;
  theme?: CloudTheme;
  caseMode?: CaseMode;
  allowMultiple?: boolean;
  askName?: boolean;
  isLocked?: boolean;
}
