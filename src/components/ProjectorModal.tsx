import React, { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import type { CloudTheme, WordCloudSession } from '../types/session';
import { CLOUD_THEMES } from '../lib/wordLayout';
import { WordCloudCanvas } from './WordCloudCanvas';

interface ProjectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: WordCloudSession;
  joinUrl: string;
  remainingLabel: string;
  onChangeTheme: (theme: CloudTheme) => void;
}

export const ProjectorModal: React.FC<ProjectorModalProps> = ({
  isOpen,
  onClose,
  session,
  joinUrl,
  remainingLabel,
  onChangeTheme,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const spec = CLOUD_THEMES[session.theme] || CLOUD_THEMES.editorial;
  const isDark = spec.isDark;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto transition-colors duration-200"
      style={{
        backgroundColor: isDark ? '#070A10' : '#F8FAFC',
        color: spec.textPrimary,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Fullscreen presentation mode"
    >
      {/* Top projector bar */}
      <div
        className="flex items-center justify-between gap-4 border-b px-6 py-4"
        style={{
          borderColor: isDark ? 'rgba(148, 163, 184, 0.16)' : '#E2E8F0',
        }}
      >
        <div className="flex items-center gap-3 text-xs tabular-nums" style={{ color: spec.textMuted }}>
          <Monitor className="h-4 w-4" aria-hidden="true" />
          <span className="font-semibold" style={{ color: spec.textPrimary }}>
            Lexicon Live
          </span>
          <span aria-hidden="true">·</span>
          <span>{session.responses.length} responses</span>
          <span aria-hidden="true">·</span>
          <span>Auto-clears in {remainingLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChangeTheme(isDark ? 'editorial' : 'obsidian')}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap"
            style={{
              borderColor: isDark ? 'rgba(148, 163, 184, 0.24)' : '#CBD5E1',
              color: spec.textPrimary,
            }}
          >
            {isDark ? (
              <>
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Light Stage</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Dark Stage</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap"
            style={{
              borderColor: isDark ? 'rgba(148, 163, 184, 0.24)' : '#CBD5E1',
              color: spec.textPrimary,
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span>Exit Presentation</span>
          </button>
        </div>
      </div>

      {/* Main presentation grid */}
      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-center gap-8 px-6 py-8 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-5">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
              {session.title}
            </h1>
            <p
              className="mt-3 text-lg leading-relaxed sm:text-xl"
              style={{ color: spec.textMuted }}
            >
              {session.question}
            </p>
          </div>

          <WordCloudCanvas
            words={session.words}
            totalResponses={session.responses.length}
            theme={session.theme}
            title={session.title}
            colorBySentiment={session.colorBySentiment}
            showExport={false}
          />
        </div>

        {/* Scannable QR column */}
        <div className="lg:col-span-4 flex flex-col items-center justify-center">
          <div className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-900 shadow-sm">
            <p className="text-xs font-semibold tracking-wide text-blue-700">
              Scan with mobile camera
            </p>
            <div className="mt-4 flex justify-center">
              <QRCodeSVG
                value={joinUrl}
                size={232}
                level="M"
                includeMargin={true}
                bgColor="#FFFFFF"
                fgColor="#0F172A"
              />
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-500">Or enter code</div>
              <div className="mt-0.5 font-mono text-2xl font-bold tracking-[0.22em] text-slate-900 tabular-nums">
                {session.code}
              </div>
              <div className="mt-2 truncate font-mono text-[11px] text-slate-500">
                {joinUrl}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
