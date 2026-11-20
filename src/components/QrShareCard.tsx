import React, { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download, Presentation, Smartphone } from 'lucide-react';
import type { WordCloudSession } from '../types/session';

interface QrShareCardProps {
  session: WordCloudSession;
  joinUrl: string;
  baseOrigin: string;
  configuredAppUrl?: string;
  onChangeBaseOrigin?: (origin: string) => void;
  onOpenMobilePreview: () => void;
  onOpenPowerPointEmbed: () => void;
}

export const QrShareCard: React.FC<QrShareCardProps> = ({
  session,
  joinUrl,
  baseOrigin,
  configuredAppUrl,
  onChangeBaseOrigin,
  onOpenMobilePreview,
  onOpenPowerPointEmbed,
}) => {
  const [copied, setCopied] = useState(false);
  const qrWrapperRef = useRef<HTMLDivElement | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy via temporary input
      const input = document.createElement('input');
      input.value = joinUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadPoster = () => {
    const svgEl = qrWrapperRef.current?.querySelector('svg');
    if (!svgEl) return;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const W = 900;
      const H = 1120;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 4;
      ctx.strokeRect(32, 32, W - 64, H - 64);

      ctx.fillStyle = '#1D4ED8';
      ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SCAN WITH MOBILE CAMERA TO RESPOND', W / 2, 108);

      ctx.fillStyle = '#0F172A';
      ctx.font = '700 44px "Bricolage Grotesque", sans-serif';
      ctx.fillText(session.title.slice(0, 38), W / 2, 178);

      ctx.fillStyle = '#475569';
      ctx.font = '400 26px "Plus Jakarta Sans", sans-serif';
      const qWords = session.question.split(' ');
      let line = '';
      let y = 236;
      for (const w of qWords) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > 740) {
          ctx.fillText(line, W / 2, y);
          line = w;
          y += 36;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, W / 2, y);

      const qrSize = 480;
      ctx.drawImage(img, (W - qrSize) / 2, 340, qrSize, qrSize);

      ctx.fillStyle = '#0F172A';
      ctx.font = '600 32px "JetBrains Mono", monospace';
      ctx.fillText(`JOIN CODE: ${session.code}`, W / 2, 895);

      ctx.fillStyle = '#64748B';
      ctx.font = '400 20px "JetBrains Mono", monospace';
      ctx.fillText(joinUrl.slice(0, 62), W / 2, 950);

      ctx.fillStyle = '#94A3B8';
      ctx.font = '400 18px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Responses clear automatically after 48 hours for privacy.', W / 2, 1030);

      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `qr-${session.code.toLowerCase()}.png`;
      link.href = pngUrl;
      link.click();
      URL.revokeObjectURL(svgUrl);
    };
    img.src = svgUrl;
  };

  const canSwitchOrigin =
    Boolean(configuredAppUrl) &&
    configuredAppUrl !== window.location.origin &&
    Boolean(onChangeBaseOrigin);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Mobile Camera QR Access
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Scan on iOS or Android camera to open the response form.
          </p>
        </div>
        <span className="font-mono text-xs font-semibold tracking-wider text-blue-700 tabular-nums">
          {session.code}
        </span>
      </div>

      <div
        ref={qrWrapperRef}
        className="mt-4 flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-4"
      >
        <QRCodeSVG
          value={joinUrl}
          size={196}
          level="M"
          includeMargin={true}
          bgColor="#FFFFFF"
          fgColor="#0F172A"
        />
        <div className="mt-2 text-center">
          <div className="text-xs text-slate-500">Join Code</div>
          <div className="font-mono text-lg font-semibold tracking-[0.2em] text-slate-900 tabular-nums">
            {session.code}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={joinUrl}
            aria-label="Participant join URL"
            className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-700 focus:border-blue-700 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {canSwitchOrigin && onChangeBaseOrigin && configuredAppUrl && (
          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-slate-500">
            <span>QR Host:</span>
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => onChangeBaseOrigin(window.location.origin)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  baseOrigin === window.location.origin
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Current Origin
              </button>
              <button
                type="button"
                onClick={() => onChangeBaseOrigin(configuredAppUrl)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  baseOrigin === configuredAppUrl
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                App URL
              </button>
            </div>
          </div>
        )}

        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleDownloadPoster}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>QR Poster</span>
          </button>
          <button
            type="button"
            onClick={onOpenMobilePreview}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
          >
            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Mobile View</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenPowerPointEmbed}
          className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
        >
          <Presentation className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
          <span>Embed in PowerPoint</span>
        </button>
      </div>
    </div>
  );
};
