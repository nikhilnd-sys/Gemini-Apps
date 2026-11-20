import React, { useMemo, useState } from 'react';
import { Mail, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { WordCloudSession } from '../types/session';
import {
  buildReviewEmailPayload,
  sendGmailReview,
} from '../lib/firebaseAuth';

interface EmailReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: WordCloudSession;
  googleUser: User | null;
  hasAccessToken: boolean;
  onSignIn: () => Promise<void>;
  onEmailSent: (recipient: string, subject: string, responseCount: number) => Promise<void>;
}

export const EmailReviewModal: React.FC<EmailReviewModalProps> = ({
  isOpen,
  onClose,
  session,
  googleUser,
  hasAccessToken,
  onSignIn,
  onEmailSent,
}) => {
  const [recipient, setRecipient] = useState(
    session.organizerEmail || googleUser?.email || ''
  );
  const [sending, setSending] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setRecipient((prev) => prev || session.organizerEmail || googleUser?.email || '');
      setErrorMsg(null);
    }
  }, [isOpen, session.organizerEmail, googleUser?.email]);

  const effectiveRecipient = recipient.trim() || googleUser?.email || '';

  const payload = useMemo(
    () => buildReviewEmailPayload(session, effectiveRecipient),
    [session, effectiveRecipient]
  );

  if (!isOpen) return null;

  const handleSignInClick = async () => {
    setErrorMsg(null);
    setSigningIn(true);
    try {
      await onSignIn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleConfirmSend = async () => {
    if (!effectiveRecipient) {
      setErrorMsg('Please enter an organizer email address.');
      return;
    }
    setErrorMsg(null);
    setSending(true);
    try {
      await sendGmailReview(payload, googleUser?.email);
      await onEmailSent(effectiveRecipient, payload.subject, session.responses.length);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to send review email via Gmail.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-confirm-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Mail className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <h2
              id="email-confirm-title"
              className="font-display text-lg font-semibold text-slate-900"
            >
              Confirm Review Email via Gmail
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700"
            aria-label="Close confirmation dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <p className="text-sm leading-relaxed text-slate-600">
            Review the email details below before sending{' '}
            <strong className="font-semibold text-slate-900">
              {session.responses.length} participant{' '}
              {session.responses.length === 1 ? 'response' : 'responses'}
            </strong>{' '}
            ({session.words.length} unique terms) from your Gmail account.
          </p>

          <div>
            <label
              htmlFor="modal-recipient"
              className="block text-xs font-semibold text-slate-700"
            >
              Recipient Organizer Email
            </label>
            <input
              id="modal-recipient"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="organizer@example.com"
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
            <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
              <span className="font-semibold text-slate-500">Subject</span>
              <span className="font-medium text-slate-900 text-right">{payload.subject}</span>
            </div>
            <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-700">
              {payload.textBody}
            </pre>
          </div>

          {!hasAccessToken && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-3 text-xs font-medium text-slate-700">
                Sign in with Google to grant permission to send this summary via Gmail:
              </p>
              <button
                type="button"
                onClick={handleSignInClick}
                disabled={signingIn}
                className="gsi-material-button w-full"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {signingIn ? 'Connecting Google Account…' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            </div>
          )}

          {errorMsg && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {errorMsg}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmSend}
            disabled={sending || !hasAccessToken || !effectiveRecipient}
            className="min-h-[40px] rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
          >
            {sending ? 'Sending Email…' : 'Confirm & Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
};
