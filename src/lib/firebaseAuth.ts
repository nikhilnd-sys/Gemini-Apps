import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type { WordCloudSession } from '../types/session';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
// Cache the access token strictly in memory — never in localStorage or sessionStorage
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Gmail permission token from Google sign-in.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ReviewEmailPayload {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

export function buildReviewEmailPayload(
  session: WordCloudSession,
  recipientOverride?: string
): ReviewEmailPayload {
  const to = (recipientOverride || session.organizerEmail || '').trim();
  const subject = `[Lexicon Live] Responses for "${session.title}" (${session.responses.length} total)`;
  const expiresDate = new Date(session.expiresAt).toLocaleString();

  const topWordsLines = session.words
    .slice(0, 25)
    .map((w, idx) => `${idx + 1}. ${w.text} (${w.count})`)
    .join('\n');

  const responseLines = session.responses
    .slice()
    .reverse()
    .map((r) => {
      const time = new Date(r.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const who = r.participantName ? ` — ${r.participantName}` : '';
      return `• ${r.text}${who} (${time})`;
    })
    .join('\n');

  const textBody = [
    `Lexicon Live — Organizer Response Digest`,
    `Title: ${session.title}`,
    `Question: ${session.question}`,
    `Session Code: ${session.code}`,
    `Total Submissions: ${session.responses.length} (${session.words.length} unique terms)`,
    `Auto-Expires: ${expiresDate} (48-hour privacy policy)`,
    ``,
    `TOP TERMS`,
    topWordsLines || '(No responses yet)',
    ``,
    `ALL RESPONSES (NEWEST FIRST)`,
    responseLines || '(No responses yet)',
  ].join('\n');

  const topWordsHtml = session.words
    .slice(0, 25)
    .map(
      (w) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${escapeHtml(w.text)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;color:#1d4ed8;">${w.count}</td>
      </tr>`
    )
    .join('');

  const responsesHtml = session.responses
    .slice()
    .reverse()
    .map((r) => {
      const time = new Date(r.createdAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#0f172a;">${escapeHtml(r.text)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#475569;">${escapeHtml(r.participantName || 'Anonymous')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b;font-size:12px;">${escapeHtml(time)}</td>
      </tr>`;
    })
    .join('');

  const htmlBody = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;background:#ffffff;">
    <div style="border-bottom:1px solid #e2e8f0;padding-bottom:16px;margin-bottom:20px;">
      <div style="font-size:12px;color:#475569;margin-bottom:4px;">Lexicon Live · Session ${escapeHtml(session.code)}</div>
      <h1 style="margin:0 0 8px 0;font-size:22px;color:#0f172a;">${escapeHtml(session.title)}</h1>
      <p style="margin:0;font-size:15px;color:#334155;">${escapeHtml(session.question)}</p>
    </div>

    <div style="margin-bottom:24px;font-size:13px;color:#475569;">
      <strong>${session.responses.length}</strong> total responses · <strong>${session.words.length}</strong> unique terms · Auto-clears ${escapeHtml(expiresDate)}
    </div>

    <h2 style="font-size:15px;margin:0 0 10px 0;color:#0f172a;">Top Terms</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:24px;font-size:14px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;">Term</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;">Count</th>
        </tr>
      </thead>
      <tbody>
        ${topWordsHtml || '<tr><td colspan="2" style="padding:12px;color:#64748b;">No terms submitted yet.</td></tr>'}
      </tbody>
    </table>

    <h2 style="font-size:15px;margin:0 0 10px 0;color:#0f172a;">All Submitted Responses</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;font-size:13px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;">Response</th>
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;">Participant</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;">Submitted</th>
        </tr>
      </thead>
      <tbody>
        ${responsesHtml || '<tr><td colspan="3" style="padding:12px;color:#64748b;">No responses yet.</td></tr>'}
      </tbody>
    </table>
  </div>`;

  return { to, subject, textBody, htmlBody };
}

export function buildRawMimeMessage(payload: ReviewEmailPayload, fromEmail?: string | null): string {
  const boundary = `lexicon_${Date.now().toString(36)}`;
  const headers = [
    ...(fromEmail ? [`From: ${fromEmail}`] : []),
    `To: ${payload.to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(payload.subject)))}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    payload.textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    payload.htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  return body;
}

export async function sendGmailReview(
  payload: ReviewEmailPayload,
  fromEmail?: string | null
): Promise<{ id: string }> {
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error('Please sign in with Google to grant Gmail sending permission.');
  }
  if (!payload.to) {
    throw new Error('Please enter an organizer recipient email address.');
  }

  const rawMime = buildRawMimeMessage(payload, fromEmail);
  const raw = encodeBase64Url(rawMime);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg =
      errData?.error?.message || `Gmail API responded with status ${res.status}.`;
    throw new Error(msg);
  }

  return (await res.json()) as { id: string };
}
