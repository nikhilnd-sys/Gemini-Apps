import React, { useMemo, useState } from 'react';
import { Check, Code2, Copy, Download, ExternalLink, Presentation, X } from 'lucide-react';
import type { WordCloudSession } from '../types/session';
import type { EmbedQrMode } from './EmbedView';

interface PowerPointEmbedModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: WordCloudSession;
  baseOrigin: string;
}

export const PowerPointEmbedModal: React.FC<PowerPointEmbedModalProps> = ({
  isOpen,
  onClose,
  session,
  baseOrigin,
}) => {
  const [qrMode, setQrMode] = useState<EmbedQrMode>('side');
  const [themeMode, setThemeMode] = useState<'studio' | 'editorial' | 'obsidian'>('studio');
  const [copiedField, setCopiedField] = useState<'url' | 'webviewer' | 'iframe' | null>(null);

  const cleanOrigin = baseOrigin.replace(/\/+$/, '');

  const embedUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('embed', session.code);
    if (qrMode !== 'side') params.set('qr', qrMode);
    if (themeMode !== 'studio') params.set('theme', themeMode);
    return `${cleanOrigin}/?${params.toString()}`;
  }, [cleanOrigin, session.code, qrMode, themeMode]);

  // Microsoft PowerPoint's "Web Viewer" add-in prepends https:// automatically,
  // so providing the host+path without scheme prevents double-https:// errors.
  const webViewerUrl = useMemo(
    () => embedUrl.replace(/^https?:\/\//i, ''),
    [embedUrl]
  );

  const iframeSnippet = useMemo(
    () =>
      `<iframe src="${embedUrl}" width="1280" height="720" style="border:0;width:100%;aspect-ratio:16/9;" allow="fullscreen" title="${session.title.replace(/"/g, '&quot;')}"></iframe>`,
    [embedUrl, session.title]
  );

  const manifestDownloadUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('origin', cleanOrigin);
    if (qrMode !== 'side') params.set('qr', qrMode);
    if (themeMode !== 'studio') params.set('theme', themeMode);
    return `/api/sessions/${encodeURIComponent(session.code)}/powerpoint-manifest.xml?${params.toString()}`;
  }, [cleanOrigin, session.code, qrMode, themeMode]);

  if (!isOpen) return null;

  const copyText = async (value: string, field: 'url' | 'webviewer' | 'iframe') => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement('input');
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ppt-embed-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Presentation className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <div>
              <h2
                id="ppt-embed-title"
                className="font-display text-lg font-semibold text-slate-900"
              >
                Embed Live Slide in PowerPoint
              </h2>
              <p className="text-xs text-slate-500">
                Updates live inside your slide deck as participants submit responses.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700"
            aria-label="Close PowerPoint embed dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-12">
          {/* Controls & Embed Options */}
          <div className="space-y-5 lg:col-span-5">
            <div>
              <span className="block text-xs font-semibold text-slate-700">
                Slide QR Placement
              </span>
              <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    { id: 'side', label: 'Side QR' },
                    { id: 'corner', label: 'Corner QR' },
                    { id: 'none', label: 'Cloud Only' },
                  ] as { id: EmbedQrMode; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setQrMode(opt.id)}
                    className={`min-h-[36px] rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      qrMode === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700">
                Slide Background
              </span>
              <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    { id: 'studio', label: 'Match Studio' },
                    { id: 'editorial', label: 'Light Slide' },
                    { id: 'obsidian', label: 'Dark Slide' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setThemeMode(opt.id)}
                    className={`min-h-[36px] rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      themeMode === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Option 1: PowerPoint Web Viewer / LiveSlides URL */}
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  1. PowerPoint Web Viewer (Recommended)
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  In PowerPoint, open <strong>Insert → Add-ins → Web Viewer</strong>, paste the address below (without <code className="font-mono">https://</code>), and click Preview.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webViewerUrl}
                    aria-label="PowerPoint Web Viewer URL without https prefix"
                    className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-[11px] text-slate-800 focus:border-blue-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(webViewerUrl, 'webviewer')}
                    className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    {copiedField === 'webviewer' ? (
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
              </div>

              {/* Option 2: Direct Live Slide URL */}
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  2. Full Live Slide URL (LiveSlides / Google Slides / Browser)
                </h3>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={embedUrl}
                    aria-label="Full live slide embed URL"
                    className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-[11px] text-slate-800 focus:border-blue-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(embedUrl, 'url')}
                    className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    {copiedField === 'url' ? (
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
              </div>

              {/* Option 3: Office Content Add-in Manifest + Iframe */}
              <div className="pt-1">
                <h3 className="text-xs font-semibold text-slate-900">
                  3. PowerPoint Office Add-in &amp; HTML Embed
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Sideload the Office Content Add-in XML directly in PowerPoint Desktop/Web, or copy the 16:9 iframe snippet.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <a
                    href={manifestDownloadUrl}
                    download={`lexicon-live-${session.code.toLowerCase()}.xml`}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download PowerPoint Add-in (.xml)</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => copyText(iframeSnippet, 'iframe')}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    {copiedField === 'iframe' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                        <span>Copied &lt;iframe&gt;</span>
                      </>
                    ) : (
                      <>
                        <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Copy &lt;iframe&gt;</span>
                      </>
                    )}
                  </button>
                  <a
                    href={embedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Open Slide</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Live 16:9 PowerPoint Slide Preview */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-100 p-4 lg:col-span-7">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-600">
              <span className="font-semibold text-slate-800">
                Live 16:9 Slide Output Preview
              </span>
              <span className="font-mono tabular-nums">
                Updates automatically in real time
              </span>
            </div>

            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              <iframe
                src={`/?embed=${encodeURIComponent(session.code)}${qrMode !== 'side' ? `&qr=${qrMode}` : ''}${themeMode !== 'studio' ? `&theme=${themeMode}` : ''}`}
                title="PowerPoint live slide output preview"
                className="h-full w-full border-0"
              />
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Tip: Keep the slide in PowerPoint Slide Show mode—participants scan the QR code on the slide and words appear live without refreshing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
