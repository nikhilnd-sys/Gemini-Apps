import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck } from 'lucide-react';
import type { CloudTheme, WordCloudSession } from '../types/session';
import { CLOUD_THEMES } from '../lib/wordLayout';
import { WordCloudCanvas } from './WordCloudCanvas';

export type EmbedQrMode = 'side' | 'corner' | 'none';

interface EmbedViewProps {
  session: WordCloudSession | null;
  isLoading: boolean;
  isExpiredOrMissing: boolean;
  joinUrl: string;
  remainingLabel: string;
  themeOverride?: CloudTheme | null;
  qrMode?: EmbedQrMode;
  isLiveConnected?: boolean;
}

export const EmbedView: React.FC<EmbedViewProps> = ({
  session,
  isLoading,
  isExpiredOrMissing,
  joinUrl,
  remainingLabel,
  themeOverride = null,
  qrMode = 'side',
  isLiveConnected = true,
}) => {
  if (isLoading && !session) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#F8F9FA] p-6">
        <div className="w-full max-w-md space-y-3 text-center">
          <div className="mx-auto h-6 w-48 animate-pulse rounded bg-slate-200" />
          <div className="mx-auto h-4 w-72 animate-pulse rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  if (isExpiredOrMissing || !session) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#F8F9FA] p-8 text-center text-slate-900">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-400" aria-hidden="true" />
          <h1 className="mt-4 font-display text-2xl font-bold text-slate-900 text-balance">
            Live Slide Cleared
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This word cloud session was automatically cleared after 48 hours for privacy and data freshness.
          </p>
        </div>
      </div>
    );
  }

  const activeTheme = themeOverride || session.theme;
  const spec = CLOUD_THEMES[activeTheme] || CLOUD_THEMES.editorial;
  const isDark = spec.isDark;

  return (
    <div
      className="relative flex min-h-screen w-full flex-col justify-between overflow-hidden px-5 py-4 sm:px-8 sm:py-6"
      style={{
        backgroundColor: isDark ? '#070A10' : '#F8FAFC',
        color: spec.textPrimary,
      }}
    >
      {/* Slide Header */}
      <header className="flex flex-wrap items-baseline justify-between gap-4 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl text-balance">
            {session.title}
          </h1>
          <p
            className="mt-1.5 text-sm leading-snug sm:text-base lg:text-lg"
            style={{ color: spec.textMuted }}
          >
            {session.question}
          </p>
        </div>

        <div
          className="flex items-center gap-2.5 text-xs tabular-nums shrink-0"
          style={{ color: spec.textMuted }}
        >
          <span className="font-semibold" style={{ color: spec.textPrimary }}>
            {session.responses.length}{' '}
            {session.responses.length === 1 ? 'response' : 'responses'}
          </span>
          <span aria-hidden="true">·</span>
          <span>Code {session.code}</span>
          {!isLiveConnected && (
            <>
              <span aria-hidden="true">·</span>
              <span>Syncing</span>
            </>
          )}
        </div>
      </header>

      {/* Main Slide Body */}
      <main className="my-auto grid flex-1 grid-cols-1 items-center gap-6 py-2 sm:grid-cols-12">
        <div className={qrMode === 'side' ? 'sm:col-span-9' : 'sm:col-span-12'}>
          <WordCloudCanvas
            words={session.words}
            totalResponses={session.responses.length}
            theme={activeTheme}
            title={session.title}
            colorBySentiment={session.colorBySentiment}
            showExport={false}
          />
        </div>

        {qrMode === 'side' && (
          <aside className="flex flex-col items-center justify-center sm:col-span-3">
            <div className="w-full max-w-[230px] rounded-2xl border border-slate-200 bg-white p-4 text-center text-slate-900 shadow-sm">
              <p className="text-[11px] font-semibold tracking-wide text-blue-700">
                Scan to respond live
              </p>
              <div className="mt-3 flex justify-center">
                <QRCodeSVG
                  value={joinUrl}
                  size={168}
                  level="M"
                  includeMargin={true}
                  bgColor="#FFFFFF"
                  fgColor="#0F172A"
                />
              </div>
              <div className="mt-2 border-t border-slate-100 pt-2">
                <div className="text-[11px] text-slate-500">Join Code</div>
                <div className="font-mono text-xl font-bold tracking-[0.2em] text-slate-900 tabular-nums">
                  {session.code}
                </div>
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Corner QR overlay when qrMode === 'corner' */}
      {qrMode === 'corner' && (
        <div className="fixed bottom-4 right-4 z-20 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-slate-900 shadow-md">
          <QRCodeSVG
            value={joinUrl}
            size={84}
            level="M"
            includeMargin={false}
            bgColor="#FFFFFF"
            fgColor="#0F172A"
          />
          <div className="pr-1">
            <div className="text-[11px] font-semibold text-blue-700">Scan to join</div>
            <div className="font-mono text-base font-bold tracking-widest text-slate-900 tabular-nums">
              {session.code}
            </div>
          </div>
        </div>
      )}

      {/* Subtle slide footer */}
      <footer
        className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] tabular-nums"
        style={{ color: spec.textMuted }}
      >
        <span>Lexicon Live</span>
        <span>Clears automatically in {remainingLabel}</span>
      </footer>
    </div>
  );
};
