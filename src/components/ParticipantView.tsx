import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Cloud, Send, ShieldCheck } from 'lucide-react';
import type { WordCloudSession } from '../types/session';
import { WordCloudCanvas } from './WordCloudCanvas';

interface ParticipantViewProps {
  session: WordCloudSession | null;
  isLoading: boolean;
  isExpiredOrMissing: boolean;
  remainingLabel: string;
  onSubmitResponse: (text: string, participantName?: string) => Promise<void>;
  onSwitchToOrganizer?: () => void;
  isPreviewMode?: boolean;
}

export const ParticipantView: React.FC<ParticipantViewProps> = ({
  session,
  isLoading,
  isExpiredOrMissing,
  remainingLabel,
  onSubmitResponse,
  onSwitchToOrganizer,
  isPreviewMode = false,
}) => {
  const [text, setText] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [lastSubmittedWord, setLastSubmittedWord] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLiveCloud, setShowLiveCloud] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setErrorMsg('Please enter at least one word or short phrase.');
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onSubmitResponse(trimmed, participantName.trim() || undefined);
      setLastSubmittedWord(trimmed);
      setSubmittedCount((c) => c + 1);
      setText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit response.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8F9FA] px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6">
          <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 h-7 w-3/4 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-12 w-full animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (isExpiredOrMissing || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8F9FA] px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-400" aria-hidden="true" />
          <h1 className="mt-4 font-display text-xl font-bold text-slate-900 text-balance">
            Session Ended or Cleared
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This word cloud session either does not exist or was automatically cleared after 48 hours for privacy and data freshness.
          </p>
          {onSwitchToOrganizer && (
            <button
              type="button"
              onClick={onSwitchToOrganizer}
              className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              Open Organizer Studio
            </button>
          )}
        </div>
      </div>
    );
  }

  const alreadySubmittedLocked = !session.allowMultiple && submittedCount > 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#F8F9FA] text-slate-900">
      {/* Compact mobile sticky header <= 56px */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          {isPreviewMode && onSwitchToOrganizer && (
            <button
              type="button"
              onClick={onSwitchToOrganizer}
              className="inline-flex min-h-[44px] min-w-[44px] -ml-2 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700"
              aria-label="Back to organizer studio"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <span className="font-display text-base font-bold tracking-tight text-slate-900 truncate">
            Lexicon Live
          </span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="font-mono text-xs font-medium text-slate-500 tabular-nums shrink-0">
            {session.code}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowLiveCloud((v) => !v)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap shrink-0"
        >
          <Cloud className="h-4 w-4" aria-hidden="true" />
          <span>{showLiveCloud ? 'Hide Cloud' : 'Live Cloud'}</span>
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-between px-4 pt-6 pb-28 sm:px-6">
        <div className="space-y-6">
          {/* Prompt Card */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
              <span>{session.responses.length} responses</span>
              <span aria-hidden="true">·</span>
              <span>Clears in {remainingLabel}</span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl text-balance">
              {session.title}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-slate-700 sm:text-lg">
              {session.question}
            </p>
          </section>

          {showLiveCloud && (
            <section>
              <WordCloudCanvas
                words={session.words}
                totalResponses={session.responses.length}
                theme={session.theme}
                title={session.title}
                compact={true}
                showExport={false}
              />
            </section>
          )}

          {/* Submission confirmation */}
          {submittedCount > 0 && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  Added &ldquo;{lastSubmittedWord}&rdquo; to the word cloud
                </p>
                <p className="mt-0.5 text-xs text-emerald-800">
                  {session.allowMultiple
                    ? 'You can submit another response below, or tap Live Cloud above to watch it update.'
                    : 'Thank you for participating. Your response has been recorded for the organizer.'}
                </p>
              </div>
            </div>
          )}

          {session.isLocked ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">Submissions paused by organizer</p>
              <p className="mt-1 text-amber-800">
                The organizer has temporarily locked new responses for this session.
              </p>
            </div>
          ) : alreadySubmittedLocked ? null : (
            <form id="participant-response-form" onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <label
                  htmlFor="word-input"
                  className="block text-sm font-semibold text-slate-900"
                >
                  Your word or short phrase
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Separate multiple words with commas if you want to share more than one idea.
                </p>
                <input
                  id="word-input"
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={140}
                  placeholder="e.g., Collaboration, Clarity, Speed"
                  autoComplete="off"
                  autoFocus={!isPreviewMode}
                  className="mt-3 min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />

                {session.askName && (
                  <div className="mt-4">
                    <label
                      htmlFor="participant-name"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Your name (optional)
                    </label>
                    <input
                      id="participant-name"
                      type="text"
                      value={participantName}
                      onChange={(e) => setParticipantName(e.target.value)}
                      maxLength={50}
                      placeholder="First name or initials"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>
                )}

                {errorMsg && (
                  <p role="alert" className="mt-3 text-xs font-medium text-red-700">
                    {errorMsg}
                  </p>
                )}
              </div>
            </form>
          )}

          <p className="px-1 text-center text-xs leading-relaxed text-slate-500">
            Privacy notice: Responses are sent to the organizer for review and automatically purged after 48 hours.
          </p>
        </div>
      </main>

      {/* Thumb-zone sticky submit CTA */}
      {!session.isLocked && !alreadySubmittedLocked && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto max-w-2xl">
            <button
              type="submit"
              form="participant-response-form"
              disabled={submitting || !text.trim()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span>{submitting ? 'Sending Response…' : 'Submit to Word Cloud'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
