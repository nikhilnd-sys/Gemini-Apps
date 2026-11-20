import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Clock,
  Download,
  ExternalLink,
  Lock,
  Mail,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import type {
  CaseMode,
  CloudTheme,
  Sentiment,
  WordCloudSession,
} from './types/session';
import {
  buildReviewEmailPayload,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './lib/firebaseAuth';
import { CLOUD_THEMES, SENTIMENT_META } from './lib/wordLayout';
import { WordCloudCanvas } from './components/WordCloudCanvas';
import { QrShareCard } from './components/QrShareCard';
import { ParticipantView } from './components/ParticipantView';
import { EmailReviewModal } from './components/EmailReviewModal';
import { ProjectorModal } from './components/ProjectorModal';
import { VideoAnimatorSection } from './components/VideoAnimatorSection';
import { EmbedView, type EmbedQrMode } from './components/EmbedView';
import { PowerPointEmbedModal } from './components/PowerPointEmbedModal';

const STORAGE_CODE_KEY = 'lexicon_live_active_code';

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00h 00m 00s';
  const totalSec = Math.floor(msRemaining / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

function getInitialJoinCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const join = params.get('join');
  return join ? join.trim().toUpperCase() : null;
}

function getInitialEmbedParams(): {
  code: string | null;
  qr: EmbedQrMode;
  theme: CloudTheme | null;
} {
  if (typeof window === 'undefined') {
    return { code: null, qr: 'side', theme: null };
  }
  const params = new URLSearchParams(window.location.search);
  const embed = params.get('embed');
  const qrParam = params.get('qr');
  const themeParam = params.get('theme');
  const validThemes: CloudTheme[] = ['editorial', 'cobalt', 'botanical', 'obsidian'];
  return {
    code: embed ? embed.trim().toUpperCase() : null,
    qr: qrParam === 'corner' || qrParam === 'none' ? qrParam : 'side',
    theme: validThemes.includes(themeParam as CloudTheme)
      ? (themeParam as CloudTheme)
      : null,
  };
}

export default function App() {
  const initialEmbed = useMemo(() => getInitialEmbedParams(), []);
  const [urlJoinCode, setUrlJoinCode] = useState<string | null>(() =>
    getInitialJoinCodeFromUrl()
  );
  const [viewMode, setViewMode] = useState<'organizer' | 'participant' | 'embed'>(() => {
    if (initialEmbed.code) return 'embed';
    if (getInitialJoinCodeFromUrl()) return 'participant';
    return 'organizer';
  });

  const [session, setSession] = useState<WordCloudSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [expiredOrMissing, setExpiredOrMissing] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Runtime URL config for QR sharing
  const [configuredAppUrl, setConfiguredAppUrl] = useState<string>('');
  const [qrBaseOrigin, setQrBaseOrigin] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );

  // Organizer customization draft state
  const [draftTitle, setDraftTitle] = useState('');
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftTheme, setDraftTheme] = useState<CloudTheme>('editorial');
  const [draftCaseMode, setDraftCaseMode] = useState<CaseMode>('title');
  const [draftColorBySentiment, setDraftColorBySentiment] = useState(true);
  const [draftAllowMultiple, setDraftAllowMultiple] = useState(true);
  const [draftAskName, setDraftAskName] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSavedNotice, setPromptSavedNotice] = useState<string | null>(null);

  // Quick organizer/desktop response add & join by code
  const [quickWord, setQuickWord] = useState('');
  const [quickSentiment, setQuickSentiment] = useState<Sentiment>('neutral');
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  // Responses table search & view tab
  const [responseSearch, setResponseSearch] = useState('');
  const [responseTab, setResponseTab] = useState<'recent' | 'terms'>('recent');

  // Confirmation states (never window.confirm / window.alert)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearingResponses, setClearingResponses] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [projectorOpen, setProjectorOpen] = useState(false);
  const [pptEmbedOpen, setPptEmbedOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  // Firebase Google Auth state (access token cached strictly in memory via firebaseAuth.ts)
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailStatusBanner, setEmailStatusBanner] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const syncDraftsFromSession = useCallback((s: WordCloudSession) => {
    setDraftTitle(s.title);
    setDraftQuestion(s.question);
    setDraftEmail(s.organizerEmail || '');
    setDraftTheme(s.theme);
    setDraftCaseMode(s.caseMode);
    setDraftColorBySentiment(s.colorBySentiment !== false);
    setDraftAllowMultiple(s.allowMultiple);
    setDraftAskName(s.askName);
  }, []);

  // Tick 1s clock for the 48-hour countdown
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Fetch server config (APP_URL if configured)
  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.appUrl && typeof data.appUrl === 'string') {
          const clean = data.appUrl.replace(/\/+$/, '');
          setConfiguredAppUrl(clean);
        }
      })
      .catch(() => {});
  }, []);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setHasAccessToken(Boolean(token));
        setDraftEmail((prev) => prev || user.email || '');
      },
      () => {
        setGoogleUser(null);
        setHasAccessToken(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const createFreshSession = useCallback(async () => {
    setLoading(true);
    setExpiredOrMissing(false);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Team Pulse Check',
          question: 'In one or two words, what should our top priority be right now?',
          organizerEmail: googleUser?.email || '',
        }),
      });
      if (!res.ok) throw new Error('Could not initialize session.');
      const data = (await res.json()) as { session: WordCloudSession };
      localStorage.setItem(STORAGE_CODE_KEY, data.session.code);
      setSession(data.session);
      syncDraftsFromSession(data.session);
    } catch {
      setExpiredOrMissing(true);
    } finally {
      setLoading(false);
    }
  }, [googleUser?.email, syncDraftsFromSession]);

  const loadSessionByCode = useCallback(
    async (code: string, fallbackToCreate = false) => {
      setLoading(true);
      setExpiredOrMissing(false);
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(code)}`);
        if (!res.ok) {
          if (fallbackToCreate) {
            await createFreshSession();
            return;
          }
          setSession(null);
          setExpiredOrMissing(true);
          return;
        }
        const data = (await res.json()) as { session: WordCloudSession };
        setSession(data.session);
        syncDraftsFromSession(data.session);
      } catch {
        if (fallbackToCreate) {
          await createFreshSession();
        } else {
          setExpiredOrMissing(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [createFreshSession, syncDraftsFromSession]
  );

  // Initial load
  useEffect(() => {
    const targetUrlCode = initialEmbed.code || urlJoinCode;
    if (targetUrlCode) {
      loadSessionByCode(targetUrlCode, false);
    } else {
      const savedCode = localStorage.getItem(STORAGE_CODE_KEY);
      if (savedCode) {
        loadSessionByCode(savedCode, true);
      } else {
        createFreshSession();
      }
    }
  }, [initialEmbed.code, urlJoinCode, loadSessionByCode, createFreshSession]);

  // Real-time WebSocket subscription for the active session
  useEffect(() => {
    const activeCode = session?.code;
    if (!activeCode) return;

    let cancelled = false;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws?code=${encodeURIComponent(activeCode)}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'session:state' || msg.type === 'session:updated') {
            if (msg.session) {
              setSession(msg.session);
            }
          } else if (msg.type === 'session:expired' || msg.type === 'session:not_found') {
            setExpiredOrMissing(true);
            setSession(null);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (cancelled) return;
        const delay = Math.min(8000, 1000 * Math.pow(2, attempt));
        attempt += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      setWsConnected(false);
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [session?.code]);

  // Resilient HTTP sync fallback for embedded WebViews where WebSockets may be blocked
  useEffect(() => {
    const activeCode = session?.code || initialEmbed.code;
    if (!activeCode || wsConnected) return;

    const pollId = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(activeCode)}`);
        if (res.status === 404) {
          setExpiredOrMissing(true);
          setSession(null);
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as { session: WordCloudSession };
          setSession(data.session);
        }
      } catch {
        // Ignore transient network errors
      }
    }, 4000);

    return () => window.clearInterval(pollId);
  }, [session?.code, initialEmbed.code, wsConnected]);

  const joinUrl = useMemo(() => {
    if (!session) return '';
    const cleanBase = qrBaseOrigin.replace(/\/+$/, '');
    return `${cleanBase}/?join=${encodeURIComponent(session.code)}`;
  }, [qrBaseOrigin, session]);

  const remainingMs = session ? Math.max(0, session.expiresAt - nowMs) : 0;
  const remainingLabel = formatCountdown(remainingMs);

  const handleSaveCustomization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setSavingPrompt(true);
    setPromptSavedNotice(null);
    try {
      const res = await fetch(`/api/sessions/${session.code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          question: draftQuestion,
          organizerEmail: draftEmail,
          theme: draftTheme,
          caseMode: draftCaseMode,
          colorBySentiment: draftColorBySentiment,
          allowMultiple: draftAllowMultiple,
          askName: draftAskName,
        }),
      });
      if (!res.ok) throw new Error('Failed to save customization.');
      const data = (await res.json()) as { session: WordCloudSession };
      setSession(data.session);
      syncDraftsFromSession(data.session);
      setPromptSavedNotice('Updated live across all connected screens');
      window.setTimeout(() => setPromptSavedNotice(null), 3000);
    } catch {
      setPromptSavedNotice('Unable to save changes. Please retry.');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleThemeQuickSwitch = async (theme: CloudTheme) => {
    setDraftTheme(theme);
    if (!session) return;
    try {
      const res = await fetch(`/api/sessions/${session.code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      });
      if (res.ok) {
        const data = (await res.json()) as { session: WordCloudSession };
        setSession(data.session);
      }
    } catch {
      // Non-blocking
    }
  };

  const handleToggleLock = async () => {
    if (!session) return;
    const res = await fetch(`/api/sessions/${session.code}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isLocked: !session.isLocked }),
    });
    if (res.ok) {
      const data = (await res.json()) as { session: WordCloudSession };
      setSession(data.session);
    }
  };

  const handleSubmitParticipantResponse = async (
    text: string,
    participantName?: string,
    sentiment: Sentiment = 'neutral'
  ) => {
    const targetCode = session?.code || urlJoinCode;
    if (!targetCode) throw new Error('No active session.');
    const res = await fetch(`/api/sessions/${targetCode}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, participantName, sentiment }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not submit response.');
    }
    if (data.session) {
      setSession(data.session);
    }
  };

  const handleQuickOrganizerAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickWord.trim() || !session) return;
    setQuickSubmitting(true);
    try {
      await handleSubmitParticipantResponse(quickWord.trim(), undefined, quickSentiment);
      setQuickWord('');
    } finally {
      setQuickSubmitting(false);
    }
  };

  const handleDeleteResponse = async (responseId: string) => {
    if (!session) return;
    const res = await fetch(
      `/api/sessions/${session.code}/responses/${encodeURIComponent(responseId)}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      const data = (await res.json()) as { session: WordCloudSession };
      setSession(data.session);
    }
  };

  const handleClearAllResponses = async () => {
    if (!session) return;
    setClearingResponses(true);
    try {
      const res = await fetch(`/api/sessions/${session.code}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetWindow: true }),
      });
      if (res.ok) {
        const data = (await res.json()) as { session: WordCloudSession };
        setSession(data.session);
        setConfirmClearOpen(false);
      }
    } finally {
      setClearingResponses(false);
    }
  };

  const handleJoinExistingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCodeInput.trim().toUpperCase();
    if (!cleaned) return;
    setJoinError(null);
    const res = await fetch(`/api/sessions/${encodeURIComponent(cleaned)}`);
    if (!res.ok) {
      setJoinError('Session not found or expired.');
      return;
    }
    const data = (await res.json()) as { session: WordCloudSession };
    localStorage.setItem(STORAGE_CODE_KEY, data.session.code);
    setSession(data.session);
    syncDraftsFromSession(data.session);
    setJoinCodeInput('');
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    const res = await googleSignIn();
    if (res) {
      setGoogleUser(res.user);
      setHasAccessToken(Boolean(getAccessToken()));
      if (!draftEmail && res.user.email) {
        setDraftEmail(res.user.email);
        if (session && !session.organizerEmail) {
          await fetch(`/api/sessions/${session.code}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizerEmail: res.user.email }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.session) setSession(d.session);
            })
            .catch(() => {});
        }
      }
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setGoogleUser(null);
    setHasAccessToken(false);
  };

  const handleEmailSentLogged = async (
    recipient: string,
    subject: string,
    responseCount: number
  ) => {
    if (!session) return;
    const res = await fetch(`/api/sessions/${session.code}/email-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient,
        subject,
        responseCount,
        method: 'gmail',
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { session: WordCloudSession };
      setSession(data.session);
    }
    setEmailStatusBanner(`Review email sent to ${recipient}`);
    window.setTimeout(() => setEmailStatusBanner(null), 5000);
  };

  const handleDownloadCsv = () => {
    if (!session) return;
    const rows = [
      ['Response', 'Sentiment', 'Participant', 'Submitted At', 'Expires At'],
      ...session.responses.map((r) => [
        `"${r.text.replace(/"/g, '""')}"`,
        `"${r.sentiment || 'neutral'}"`,
        `"${(r.participantName || 'Anonymous').replace(/"/g, '""')}"`,
        `"${new Date(r.createdAt).toISOString()}"`,
        `"${new Date(r.expiresAt).toISOString()}"`,
      ]),
    ];
    const csv = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `responses-${session.code.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadEml = () => {
    if (!session) return;
    const payload = buildReviewEmailPayload(
      session,
      draftEmail || session.organizerEmail || 'organizer@example.com'
    );
    const eml = [
      `To: ${payload.to}`,
      `Subject: ${payload.subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      payload.textBody,
    ].join('\r\n');
    const blob = new Blob([eml], { type: 'message/rfc822;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `digest-${session.code.toLowerCase()}.eml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const mailtoHref = useMemo(() => {
    if (!session) return '#';
    const payload = buildReviewEmailPayload(
      session,
      draftEmail || session.organizerEmail
    );
    return `mailto:${encodeURIComponent(payload.to)}?subject=${encodeURIComponent(
      payload.subject
    )}&body=${encodeURIComponent(payload.textBody.slice(0, 1800))}`;
  }, [session, draftEmail]);

  const filteredResponses = useMemo(() => {
    if (!session) return [];
    const q = responseSearch.trim().toLowerCase();
    const list = session.responses.slice().reverse();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.text.toLowerCase().includes(q) ||
        (r.participantName || '').toLowerCase().includes(q)
    );
  }, [session, responseSearch]);

  const filteredWords = useMemo(() => {
    if (!session) return [];
    const q = responseSearch.trim().toLowerCase();
    if (!q) return session.words;
    return session.words.filter((w) => w.text.toLowerCase().includes(q));
  }, [session, responseSearch]);

  // Chromeless Live Slide Embed View for PowerPoint (?embed=CODE)
  if (viewMode === 'embed') {
    return (
      <EmbedView
        session={session}
        isLoading={loading}
        isExpiredOrMissing={expiredOrMissing}
        joinUrl={joinUrl}
        remainingLabel={remainingLabel}
        themeOverride={initialEmbed.theme}
        qrMode={initialEmbed.qr}
        isLiveConnected={wsConnected}
      />
    );
  }

  // Mobile QR-scanned Participant View (or Preview Mode)
  if (viewMode === 'participant') {
    return (
      <ParticipantView
        session={session}
        isLoading={loading}
        isExpiredOrMissing={expiredOrMissing}
        remainingLabel={remainingLabel}
        onSubmitResponse={handleSubmitParticipantResponse}
        onSwitchToOrganizer={() => {
          setUrlJoinCode(null);
          if (window.location.search.includes('join=')) {
            window.history.replaceState({}, '', '/');
          }
          setViewMode('organizer');
          if (!session) {
            const saved = localStorage.getItem(STORAGE_CODE_KEY);
            if (saved) loadSessionByCode(saved, true);
            else createFreshSession();
          }
        }}
        isPreviewMode={!urlJoinCode}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900">
      {/* Top Bar Contract: [Brand title] — [4 single-line nav links] — [1 primary CTA] */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
          <a
            href="#live-cloud"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Lexicon Live
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <a
              href="#live-cloud"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Live Cloud
            </a>
            <a
              href="#customize-prompt"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Customize
            </a>
            <a
              href="#responses-log"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Responses
            </a>
            <a
              href="#email-privacy"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Email &amp; Privacy
            </a>
            <a
              href="#animate-video"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Animate Video
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setProjectorOpen(true)}
              disabled={!session}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap shrink-0"
            >
              <Monitor className="h-4 w-4" aria-hidden="true" />
              <span>Present Live</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
        {/* Session Workspace Toolbar */}
        <section
          aria-label="Session controls"
          className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 tabular-nums">
            <span className="font-mono font-semibold text-slate-800">
              {session ? `Session ${session.code}` : 'Loading session…'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {session ? `${session.responses.length} responses` : '0 responses'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Auto-clears in {remainingLabel}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form onSubmit={handleJoinExistingCode} className="flex items-center gap-1.5">
              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                maxLength={8}
                placeholder="Open code"
                aria-label="Open session by code"
                className="min-h-[38px] w-28 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Load
              </button>
            </form>

            {session && (
              <button
                type="button"
                onClick={handleToggleLock}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                {session.isLocked ? (
                  <>
                    <Unlock className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                    <span>Resume Input</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pause Input</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={createFreshSession}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New Session</span>
            </button>
          </div>

          {joinError && (
            <p role="alert" className="w-full text-xs font-medium text-red-700">
              {joinError}
            </p>
          )}
        </section>

        {loading && !session ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="h-[460px] animate-pulse rounded-xl border border-slate-200 bg-white lg:col-span-8" />
            <div className="h-[460px] animate-pulse rounded-xl border border-slate-200 bg-white lg:col-span-4" />
          </div>
        ) : session ? (
          <>
            {/* Section 1: Live Word Cloud Stage + Mobile QR Card */}
            <section
              id="live-cloud"
              className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12"
            >
              <div className="space-y-5 lg:col-span-8">
                <div className="space-y-2">
                  <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl text-balance">
                    {session.title}
                  </h1>
                  <p className="max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
                    {session.question}
                  </p>
                </div>

                <WordCloudCanvas
                  words={session.words}
                  totalResponses={session.responses.length}
                  theme={session.theme}
                  title={session.title}
                  colorBySentiment={session.colorBySentiment}
                />

                {/* Quick desktop submission bar */}
                <form
                  onSubmit={handleQuickOrganizerAdd}
                  className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center"
                >
                  <input
                    type="text"
                    value={quickWord}
                    onChange={(e) => setQuickWord(e.target.value)}
                    disabled={session.isLocked || quickSubmitting}
                    maxLength={120}
                    placeholder={
                      session.isLocked
                        ? 'Submissions are paused'
                        : 'Add a word or comma-separated phrases directly from desktop…'
                    }
                    aria-label="Quick add word to cloud"
                    className="min-h-[42px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:bg-white focus:outline-none"
                  />
                  <div
                    role="group"
                    aria-label="Quick word sentiment"
                    className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 shrink-0"
                  >
                    {(['positive', 'neutral', 'negative'] as Sentiment[]).map((s) => {
                      const meta = SENTIMENT_META[s];
                      const active = quickSentiment === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setQuickSentiment(s)}
                          aria-pressed={active}
                          title={meta.label}
                          aria-label={meta.label}
                          className={`inline-flex min-h-[34px] min-w-[36px] items-center justify-center rounded-md px-2 text-sm transition-colors ${
                            active
                              ? 'bg-white shadow-sm ring-1 ring-slate-200'
                              : 'opacity-70 hover:opacity-100'
                          }`}
                        >
                          <span aria-hidden="true">{meta.emoji}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="submit"
                    disabled={!quickWord.trim() || session.isLocked || quickSubmitting}
                    className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Add Word</span>
                  </button>
                </form>
              </div>

              <div className="space-y-5 lg:col-span-4">
                <QrShareCard
                  session={session}
                  joinUrl={joinUrl}
                  baseOrigin={qrBaseOrigin}
                  configuredAppUrl={configuredAppUrl}
                  onChangeBaseOrigin={setQrBaseOrigin}
                  onOpenMobilePreview={() => setViewMode('participant')}
                  onOpenPowerPointEmbed={() => setPptEmbedOpen(true)}
                />

                {/* Quick Email Review Trigger Card */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-base font-semibold text-slate-900">
                      Organizer Email Review
                    </h2>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {session.emailHistory.length} sent
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Send a formatted digest of all participant responses and top terms to the organizer&rsquo;s inbox.
                  </p>
                  <button
                    type="button"
                    onClick={() => setEmailModalOpen(true)}
                    className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
                  >
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    <span>Email Responses via Gmail</span>
                  </button>
                  {emailStatusBanner && (
                    <p
                      role="status"
                      className="mt-2.5 text-xs font-medium text-emerald-700"
                    >
                      {emailStatusBanner}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Section 2: Customize Question, Title & Display */}
            <section
              id="customize-prompt"
              className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    Customize Prompt &amp; Display
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Changes update immediately on the presentation stage and every participant&rsquo;s mobile screen.
                  </p>
                </div>
                {promptSavedNotice && (
                  <span role="status" className="text-xs font-semibold text-emerald-700">
                    {promptSavedNotice}
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveCustomization} className="mt-6 space-y-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div>
                    <label
                      htmlFor="custom-title"
                      className="block text-sm font-semibold text-slate-900"
                    >
                      Display Title
                    </label>
                    <input
                      id="custom-title"
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      maxLength={120}
                      required
                      placeholder="e.g., Q4 Strategy Retrospective"
                      className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="custom-organizer-email"
                      className="block text-sm font-semibold text-slate-900"
                    >
                      Organizer Review Email
                    </label>
                    <input
                      id="custom-organizer-email"
                      type="email"
                      value={draftEmail}
                      onChange={(e) => setDraftEmail(e.target.value)}
                      maxLength={160}
                      placeholder="organizer@company.com"
                      className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="custom-question"
                    className="block text-sm font-semibold text-slate-900"
                  >
                    Question Displayed to Participants
                  </label>
                  <textarea
                    id="custom-question"
                    rows={2}
                    value={draftQuestion}
                    onChange={(e) => setDraftQuestion(e.target.value)}
                    maxLength={240}
                    required
                    placeholder="Ask a focused prompt so responses stay concise and scannable…"
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                  />
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  {/* Theme selector */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-900">
                      Word Cloud Palette
                    </span>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(Object.keys(CLOUD_THEMES) as CloudTheme[]).map((themeKey) => {
                        const spec = CLOUD_THEMES[themeKey];
                        const active = draftTheme === themeKey;
                        return (
                          <button
                            key={themeKey}
                            type="button"
                            onClick={() => handleThemeQuickSwitch(themeKey)}
                            className={`flex min-h-[42px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                              active
                                ? 'border-blue-700 bg-blue-50 text-blue-900'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded-sm border border-slate-300"
                              style={{ backgroundColor: spec.palette[1] }}
                              aria-hidden="true"
                            />
                            <span className="truncate">{spec.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Case Normalization */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-900">
                      Text Normalization
                    </span>
                    <div className="mt-2 flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                      {(
                        [
                          { id: 'title', label: 'Title Case' },
                          { id: 'lower', label: 'lowercase' },
                          { id: 'original', label: 'As Typed' },
                        ] as { id: CaseMode; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setDraftCaseMode(opt.id)}
                          className={`min-h-[36px] flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                            draftCaseMode === opt.id
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Participant permissions */}
                  <div className="space-y-3">
                    <span className="block text-sm font-semibold text-slate-900">
                      Display &amp; Participant Options
                    </span>
                    <label className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draftColorBySentiment}
                        onChange={(e) => setDraftColorBySentiment(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                      />
                      <span>Color-code word cloud by sentiment</span>
                    </label>
                    <label className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draftAllowMultiple}
                        onChange={(e) => setDraftAllowMultiple(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                      />
                      <span>Allow multiple submissions per person</span>
                    </label>
                    <label className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draftAskName}
                        onChange={(e) => setDraftAskName(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                      />
                      <span>Include optional participant name field</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end border-t border-slate-100 pt-4">
                  <button
                    type="submit"
                    disabled={savingPrompt}
                    className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap"
                  >
                    {savingPrompt ? 'Saving Changes…' : 'Save & Broadcast Changes'}
                  </button>
                </div>
              </form>
            </section>

            {/* Section 3: Submitted Responses & Moderation */}
            <section
              id="responses-log"
              className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    Submitted Responses
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 tabular-nums">
                    {session.responses.length} total submissions · {session.words.length} unique terms
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setResponseTab('recent')}
                      className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        responseTab === 'recent'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Chronological
                    </button>
                    <button
                      type="button"
                      onClick={() => setResponseTab('terms')}
                      className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        responseTab === 'terms'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Ranked Terms
                    </button>
                  </div>

                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={responseSearch}
                      onChange={(e) => setResponseSearch(e.target.value)}
                      placeholder="Filter responses…"
                      aria-label="Filter submitted responses"
                      className="min-h-[38px] w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    disabled={session.responses.length === 0}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download CSV</span>
                  </button>
                </div>
              </div>

              {session.responses.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-medium text-slate-900">
                    No participant responses yet
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Share the QR code above or switch to Mobile View to submit the first word.
                  </p>
                </div>
              ) : responseTab === 'recent' ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                        <th className="py-2.5 pr-4">Response</th>
                        <th className="py-2.5 px-4">Sentiment</th>
                        <th className="py-2.5 px-4">Participant</th>
                        <th className="py-2.5 px-4 text-right">Submitted</th>
                        <th className="py-2.5 pl-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredResponses.map((item) => {
                        const meta = SENTIMENT_META[item.sentiment || 'neutral'];
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/80">
                            <td className="py-2.5 pr-4 font-medium text-slate-900">
                              {item.text}
                            </td>
                            <td
                              className="py-2.5 px-4 text-xs font-medium whitespace-nowrap"
                              style={{ color: meta.lightColor }}
                            >
                              <span aria-hidden="true">{meta.emoji}</span>{' '}
                              <span>{meta.label}</span>
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {item.participantName || 'Anonymous'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-500 tabular-nums">
                              {new Date(item.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-2.5 pl-4 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeleteResponse(item.id)}
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-700 whitespace-nowrap"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Remove</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                        <th className="py-2.5 pr-4">Normalized Term</th>
                        <th className="py-2.5 px-4">Dominant Sentiment</th>
                        <th className="py-2.5 px-4 text-right">Mentions</th>
                        <th className="py-2.5 pl-4 text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredWords.map((word) => {
                        const meta = SENTIMENT_META[word.dominantSentiment || 'neutral'];
                        return (
                          <tr key={word.key} className="hover:bg-slate-50/80">
                            <td className="py-2.5 pr-4 font-semibold text-slate-900">
                              {word.text}
                            </td>
                            <td
                              className="py-2.5 px-4 text-xs font-medium whitespace-nowrap"
                              style={{ color: meta.lightColor }}
                            >
                              <span aria-hidden="true">{meta.emoji}</span>{' '}
                              <span>{meta.label}</span>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums">
                              {word.count}
                            </td>
                            <td className="py-2.5 pl-4 text-right font-mono text-xs text-slate-500 tabular-nums">
                              {session.responses.length > 0
                                ? `${Math.round((word.count / session.responses.length) * 100)}%`
                                : '0%'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Section 4: Email Delivery & 48-Hour Privacy Retention */}
            <section
              id="email-privacy"
              className="grid grid-cols-1 gap-8 lg:grid-cols-2"
            >
              {/* Gmail & Email Review Console */}
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      Email Digest to Organizer
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Send participant responses directly via Gmail for organizer review before the 48-hour clear.
                    </p>
                  </div>
                  <Mail className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
                </div>

                <div className="mt-5 space-y-4">
                  {hasAccessToken && googleUser ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">
                          Gmail connected: {googleUser.email}
                        </div>
                        <div className="text-slate-500">
                          Ready to send formatted review digests
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleGoogleLogout}
                        className="min-h-[34px] rounded-md border border-slate-200 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-3 text-xs text-slate-600">
                        Connect your Google account to send response digests directly through Gmail:
                      </p>
                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        className="gsi-material-button"
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
                            Sign in with Google
                          </span>
                        </div>
                      </button>
                      {authError && (
                        <p role="alert" className="mt-2 text-xs text-red-700">
                          {authError}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEmailModalOpen(true)}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap"
                    >
                      <Mail className="h-4 w-4" aria-hidden="true" />
                      <span>Preview &amp; Send via Gmail</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadEml}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download .eml</span>
                    </button>

                    <a
                      href={mailtoHref}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Default Mail App</span>
                    </a>
                  </div>

                  {/* Email Send History */}
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="text-xs font-semibold text-slate-700">
                      Recent Email Dispatches
                    </h3>
                    {session.emailHistory.length === 0 ? (
                      <p className="mt-1.5 text-xs text-slate-500">
                        No review emails sent for this session yet.
                      </p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100 text-xs">
                        {session.emailHistory.slice(0, 5).map((rec) => (
                          <li
                            key={rec.id}
                            className="flex items-center justify-between gap-2 py-2"
                          >
                            <span className="truncate font-medium text-slate-800">
                              {rec.recipient}
                            </span>
                            <span className="shrink-0 font-mono text-slate-500 tabular-nums">
                              {rec.responseCount} items ·{' '}
                              {new Date(rec.sentAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* 48-Hour Privacy & Auto-Expiration */}
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      48-Hour Privacy &amp; Freshness Policy
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      All session data and participant responses are permanently cleared after 48 hours.
                    </p>
                  </div>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                </div>

                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock className="h-4 w-4 text-slate-600" aria-hidden="true" />
                    <span>Time remaining in current 48-hour window</span>
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                    {remainingLabel}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-600">
                    Scheduled automatic purge:{' '}
                    <span className="font-medium text-slate-900">
                      {new Date(session.expiresAt).toLocaleString()}
                    </span>
                  </div>
                  {session.lastClearedAt && (
                    <div className="mt-1 text-xs text-slate-500">
                      Last manual reset: {new Date(session.lastClearedAt).toLocaleString()}
                    </div>
                  )}
                </div>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  {!confirmClearOpen ? (
                    <button
                      type="button"
                      onClick={() => setConfirmClearOpen(true)}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Clear Responses &amp; Restart 48h Window</span>
                    </button>
                  ) : (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                      <p className="text-xs font-semibold text-red-900">
                        Clear all {session.responses.length} responses now?
                      </p>
                      <p className="mt-1 text-xs text-red-800">
                        This permanently deletes current words from the cloud and resets the 48-hour timer. Email a digest first if you still need a copy.
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleClearAllResponses}
                          disabled={clearingResponses}
                          className="min-h-[36px] rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50 whitespace-nowrap"
                        >
                          {clearingResponses ? 'Clearing…' : 'Yes, Clear Now'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearOpen(false)}
                          className="min-h-[36px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Section 5: Animate Uploaded Photo into Video */}
            <VideoAnimatorSection session={session} />
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
            <h1 className="font-display text-2xl font-bold text-slate-900">
              Session Expired After 48 Hours
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              For privacy and data freshness, the previous session was automatically cleared.
            </p>
            <button
              type="button"
              onClick={createFreshSession}
              className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Start Fresh 48-Hour Session</span>
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 text-xs text-slate-500 sm:px-6 lg:px-8">
          <span>Lexicon Live · QR Word Cloud &amp; Organizer Digest</span>
          <span>Data automatically expires 48 hours after session start</span>
        </div>
      </footer>

      {session && (
        <>
          <EmailReviewModal
            isOpen={emailModalOpen}
            onClose={() => setEmailModalOpen(false)}
            session={session}
            googleUser={googleUser}
            hasAccessToken={hasAccessToken}
            onSignIn={handleGoogleSignIn}
            onEmailSent={handleEmailSentLogged}
          />
          <ProjectorModal
            isOpen={projectorOpen}
            onClose={() => setProjectorOpen(false)}
            session={session}
            joinUrl={joinUrl}
            remainingLabel={remainingLabel}
            onChangeTheme={handleThemeQuickSwitch}
          />
          <PowerPointEmbedModal
            isOpen={pptEmbedOpen}
            onClose={() => setPptEmbedOpen(false)}
            session={session}
            baseOrigin={qrBaseOrigin}
          />
        </>
      )}
    </div>
  );
}
