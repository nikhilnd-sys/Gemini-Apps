import React, { useEffect, useRef, useState } from 'react';
import { Download, Film, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import type { WordCloudSession } from '../types/session';

interface VideoAnimatorSectionProps {
  session: WordCloudSession | null;
}

type VideoAspectRatio = '16:9' | '9:16';

export const VideoAnimatorSection: React.FC<VideoAnimatorSectionProps> = ({
  session,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>('image/png');
  const [fileName, setFileName] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [prompt, setPrompt] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [generatedAspect, setGeneratedAspect] = useState<VideoAspectRatio>('16:9');

  useEffect(() => {
    return () => {
      if (generatedVideoUrl && generatedVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(generatedVideoUrl);
      }
    };
  }, [generatedVideoUrl]);

  const handleFileSelected = (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);

    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setErrorMsg('Please upload a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Please choose an image smaller than 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        setErrorMsg('Could not read the selected image.');
        return;
      }
      setImageDataUrl(result);
      setImagePreviewUrl(result);
      setImageMimeType(file.type);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleClearImage = () => {
    setImageDataUrl(null);
    setImagePreviewUrl(null);
    setFileName('');
    setErrorMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUseSessionPrompt = () => {
    if (!session) return;
    const topTerms = session.words
      .slice(0, 4)
      .map((w) => w.text)
      .join(', ');
    const base = topTerms
      ? `Smooth cinematic motion capturing themes of ${topTerms} from "${session.title}", gentle ambient light drift and subtle depth.`
      : `Smooth cinematic motion celebrating "${session.title}", subtle camera push-in and natural ambient light movement.`;
    setPrompt(base.slice(0, 380));
  };

  const handleGenerateVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageDataUrl) {
      setErrorMsg('Upload a photo first to animate it into a video.');
      return;
    }

    setErrorMsg(null);
    setGenerating(true);

    try {
      const res = await fetch('/api/animate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: imageDataUrl,
          mimeType: imageMimeType,
          aspectRatio,
          prompt: prompt.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Video generation failed (${res.status}).`);
      }

      if (!data.videoBase64) {
        throw new Error('Server did not return generated video data.');
      }

      const binary = atob(data.videoBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: data.mimeType || 'video/mp4' });
      const nextUrl = URL.createObjectURL(blob);

      if (generatedVideoUrl && generatedVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(generatedVideoUrl);
      }
      setGeneratedVideoUrl(nextUrl);
      setGeneratedAspect(data.aspectRatio === '9:16' ? '9:16' : '16:9');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to generate video right now.'
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadVideo = () => {
    if (!generatedVideoUrl) return;
    const link = document.createElement('a');
    link.href = generatedVideoUrl;
    const ratioTag = generatedAspect === '9:16' ? 'portrait' : 'landscape';
    link.download = `lexicon-animated-${ratioTag}.mp4`;
    link.click();
  };

  return (
    <section
      id="animate-video"
      className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            Animate Photo into Video
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload a photo from your session or device and animate it into a 16:9 landscape or 9:16 portrait clip.
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500">
          16:9 · 9:16 MP4
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left column: Upload & Controls */}
        <form onSubmit={handleGenerateVideo} className="space-y-5 lg:col-span-6">
          <div>
            <span className="block text-sm font-semibold text-slate-900">
              Source Photo
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
              className="sr-only"
              id="animate-photo-upload"
            />

            {!imagePreviewUrl ? (
              <label
                htmlFor="animate-photo-upload"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFileSelected(e.dataTransfer.files?.[0]);
                }}
                className="mt-2 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition-colors hover:border-blue-700 hover:bg-blue-50/40"
              >
                <ImagePlus className="h-8 w-8 text-slate-400" aria-hidden="true" />
                <span className="mt-3 text-sm font-semibold text-slate-800">
                  Choose a photo or drop it here
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  PNG, JPEG, or WebP up to 10 MB
                </span>
              </label>
            ) : (
              <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-center bg-slate-100 p-3">
                  <img
                    src={imagePreviewUrl}
                    alt="Uploaded photo preview"
                    referrerPolicy="no-referrer"
                    className="max-h-56 w-auto rounded-lg object-contain"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5 text-xs">
                  <span className="truncate font-medium text-slate-700">
                    {fileName || 'Uploaded photo'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <label
                      htmlFor="animate-photo-upload"
                      className="cursor-pointer rounded-md px-2.5 py-1.5 font-medium text-blue-700 hover:bg-blue-50 whitespace-nowrap"
                    >
                      Replace
                    </label>
                    <button
                      type="button"
                      onClick={handleClearImage}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Aspect Ratio Selector */}
          <div>
            <span className="block text-sm font-semibold text-slate-900">
              Video Aspect Ratio
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setAspectRatio('16:9')}
                className={`min-h-[40px] rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  aspectRatio === '16:9'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                16:9 Landscape
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                className={`min-h-[40px] rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  aspectRatio === '9:16'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                9:16 Portrait
              </button>
            </div>
          </div>

          {/* Motion Prompt */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="video-motion-prompt"
                className="block text-sm font-semibold text-slate-900"
              >
                Motion Direction (optional)
              </label>
              {session && (
                <button
                  type="button"
                  onClick={handleUseSessionPrompt}
                  className="text-xs font-medium text-blue-700 hover:underline underline-offset-2 whitespace-nowrap"
                >
                  Use session themes
                </button>
              )}
            </div>
            <textarea
              id="video-motion-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={400}
              placeholder="Describe how the photo should move (e.g., Gentle camera push-in as warm sunlight shifts across the room)…"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
            >
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={generating || !imageDataUrl}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Generating Video…</span>
              </>
            ) : (
              <>
                <Film className="h-4 w-4" aria-hidden="true" />
                <span>Animate Photo to Video</span>
              </>
            )}
          </button>
        </form>

        {/* Right column: Video Output Stage */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-5 lg:col-span-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-900">
              Generated Video Preview
            </span>
            {generatedVideoUrl && (
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {generatedAspect}
              </span>
            )}
          </div>

          <div className="my-4 flex flex-1 items-center justify-center">
            {generating ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Loader2
                  className="h-8 w-8 animate-spin text-blue-700"
                  aria-hidden="true"
                />
                <p className="mt-3 text-sm font-semibold text-slate-900">
                  Rendering {aspectRatio} animation
                </p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                  This usually takes 30–90 seconds while the video frames are synthesized.
                </p>
              </div>
            ) : generatedVideoUrl ? (
              <div
                className={
                  generatedAspect === '9:16'
                    ? 'mx-auto w-full max-w-[260px] overflow-hidden rounded-xl border border-slate-200 bg-black aspect-[9/16]'
                    : 'w-full overflow-hidden rounded-xl border border-slate-200 bg-black aspect-video'
                }
              >
                <video
                  src={generatedVideoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Film className="h-9 w-9 text-slate-300" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-slate-800">
                  No animated clip yet
                </p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                  Upload a photo, choose 16:9 landscape or 9:16 portrait, and animate it for your presentation or recap.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
            <span className="text-xs text-slate-500">
              Videos remain in browser memory only and are not stored on disk.
            </span>
            {generatedVideoUrl && (
              <button
                type="button"
                onClick={handleDownloadVideo}
                className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download MP4</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
