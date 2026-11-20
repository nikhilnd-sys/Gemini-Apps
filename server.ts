import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import type {
  AggregatedWord,
  CaseMode,
  CloudTheme,
  CreateSessionInput,
  EmailRecord,
  Sentiment,
  SentimentBreakdown,
  UpdateSessionInput,
  WordCloudSession,
  WordResponse,
} from './src/types/session.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TTL_MS = 48 * 60 * 60 * 1000; // Strictly 48 hours for privacy & data freshness
const DATA_DIR = path.resolve(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'sessions.json');

interface StoredSession {
  code: string;
  title: string;
  question: string;
  organizerEmail: string;
  theme: CloudTheme;
  caseMode: CaseMode;
  colorBySentiment: boolean;
  allowMultiple: boolean;
  askName: boolean;
  isLocked: boolean;
  createdAt: number;
  expiresAt: number;
  lastClearedAt: number | null;
  responses: WordResponse[];
  emailHistory: EmailRecord[];
}

const sessions = new Map<string, StoredSession>();
const roomClients = new Map<string, Set<WebSocket>>();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveStore() {
  try {
    ensureDataDir();
    const list = Array.from(sessions.values());
    fs.writeFileSync(STORE_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist sessions:', err);
  }
}

function formatWordCase(raw: string, caseMode: CaseMode): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (caseMode === 'lower') return cleaned.toLowerCase();
  if (caseMode === 'title') {
    return cleaned
      .split(' ')
      .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
      .join(' ');
  }
  return cleaned;
}

const VALID_SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative'];

function getDominantSentiment(breakdown: SentimentBreakdown): Sentiment {
  if (breakdown.positive > breakdown.negative && breakdown.positive >= breakdown.neutral) {
    return 'positive';
  }
  if (breakdown.negative > breakdown.positive && breakdown.negative >= breakdown.neutral) {
    return 'negative';
  }
  return 'neutral';
}

function aggregateWords(responses: WordResponse[], caseMode: CaseMode): AggregatedWord[] {
  const map = new Map<
    string,
    {
      variants: Map<string, number>;
      count: number;
      lastSubmittedAt: number;
      sentimentBreakdown: SentimentBreakdown;
    }
  >();

  for (const res of responses) {
    const cleaned = res.text.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    const formatted = formatWordCase(cleaned, caseMode);
    const sentiment: Sentiment = VALID_SENTIMENTS.includes(res.sentiment)
      ? res.sentiment
      : 'neutral';

    let entry = map.get(key);
    if (!entry) {
      entry = {
        variants: new Map(),
        count: 0,
        lastSubmittedAt: res.createdAt,
        sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
      };
      map.set(key, entry);
    }
    entry.count += 1;
    entry.lastSubmittedAt = Math.max(entry.lastSubmittedAt, res.createdAt);
    entry.variants.set(formatted, (entry.variants.get(formatted) || 0) + 1);
    entry.sentimentBreakdown[sentiment] += 1;
  }

  const aggregated: AggregatedWord[] = [];
  for (const [key, entry] of map.entries()) {
    let bestText = key;
    let bestCount = -1;
    for (const [variant, vCount] of entry.variants.entries()) {
      if (vCount > bestCount) {
        bestCount = vCount;
        bestText = variant;
      }
    }
    aggregated.push({
      key,
      text: bestText,
      count: entry.count,
      lastSubmittedAt: entry.lastSubmittedAt,
      dominantSentiment: getDominantSentiment(entry.sentimentBreakdown),
      sentimentBreakdown: entry.sentimentBreakdown,
    });
  }

  aggregated.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSubmittedAt - a.lastSubmittedAt;
  });

  return aggregated;
}

function toPublicSession(stored: StoredSession): WordCloudSession {
  return {
    ...stored,
    words: aggregateWords(stored.responses, stored.caseMode),
  };
}

function generateSessionCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }
  } while (sessions.has(code));
  return code;
}

function broadcastToRoom(code: string, payload: unknown) {
  const clients = roomClients.get(code);
  if (!clients || clients.size === 0) return;
  const serialized = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function purgeExpired(): boolean {
  const now = Date.now();
  let changed = false;

  for (const [code, session] of sessions.entries()) {
    if (now >= session.expiresAt) {
      sessions.delete(code);
      changed = true;
      broadcastToRoom(code, {
        type: 'session:expired',
        code,
        reason: 'Cleared automatically after 48 hours for privacy and data freshness.',
      });
      continue;
    }

    const beforeLen = session.responses.length;
    if (beforeLen > 0) {
      session.responses = session.responses.filter((r) => now < r.expiresAt);
      if (session.responses.length !== beforeLen) {
        changed = true;
        broadcastToRoom(code, {
          type: 'session:updated',
          session: toPublicSession(session),
        });
      }
    }
  }

  if (changed) {
    saveStore();
  }
  return changed;
}

function loadStore() {
  try {
    ensureDataDir();
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as StoredSession[];
    if (Array.isArray(parsed)) {
      const now = Date.now();
      for (const item of parsed) {
        if (item && item.code && now < item.expiresAt) {
          item.colorBySentiment = item.colorBySentiment !== false;
          item.responses = Array.isArray(item.responses)
            ? item.responses
                .filter((r) => now < r.expiresAt)
                .map((r) => ({
                  ...r,
                  sentiment: VALID_SENTIMENTS.includes(r.sentiment)
                    ? r.sentiment
                    : 'neutral',
                }))
            : [];
          item.emailHistory = Array.isArray(item.emailHistory) ? item.emailHistory : [];
          sessions.set(item.code.toUpperCase(), item);
        }
      }
      saveStore();
    }
  } catch (err) {
    console.error('Failed to load store:', err);
  }
}

loadStore();
// Sweep expired sessions and responses every 60 seconds
setInterval(purgeExpired, 60 * 1000);

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

const VALID_THEMES: CloudTheme[] = ['editorial', 'cobalt', 'botanical', 'obsidian'];
const VALID_CASE_MODES: CaseMode[] = ['title', 'lower', 'original'];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use((_req, res, next) => {
    res.removeHeader('X-Frame-Options');
    next();
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    purgeExpired();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const code = (url.searchParams.get('code') || '').toUpperCase().trim();

    if (!code) {
      ws.close(1008, 'Session code required');
      return;
    }

    let set = roomClients.get(code);
    if (!set) {
      set = new Set();
      roomClients.set(code, set);
    }
    set.add(ws);

    const session = sessions.get(code);
    if (session) {
      ws.send(
        JSON.stringify({
          type: 'session:state',
          session: toPublicSession(session),
        })
      );
    } else {
      ws.send(
        JSON.stringify({
          type: 'session:not_found',
          code,
        })
      );
    }

    ws.on('close', () => {
      const room = roomClients.get(code);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          roomClients.delete(code);
        }
      }
    });
  });

  // Health & runtime config
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeSessions: sessions.size });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      appUrl: process.env.APP_URL || '',
      ttlHours: 48,
    });
  });

  // Create new word cloud session
  app.post('/api/sessions', (req, res) => {
    purgeExpired();
    const body = (req.body || {}) as CreateSessionInput;
    const now = Date.now();
    const code = generateSessionCode();

    const title = sanitizeText(body.title, 120) || 'Team Pulse Check';
    const question =
      sanitizeText(body.question, 240) ||
      'In one or two words, what should our top priority be this week?';
    const organizerEmail = sanitizeText(body.organizerEmail, 160);
    const theme: CloudTheme = VALID_THEMES.includes(body.theme as CloudTheme)
      ? (body.theme as CloudTheme)
      : 'editorial';
    const caseMode: CaseMode = VALID_CASE_MODES.includes(body.caseMode as CaseMode)
      ? (body.caseMode as CaseMode)
      : 'title';

    const stored: StoredSession = {
      code,
      title,
      question,
      organizerEmail,
      theme,
      caseMode,
      colorBySentiment: body.colorBySentiment !== false,
      allowMultiple: body.allowMultiple !== false,
      askName: Boolean(body.askName),
      isLocked: false,
      createdAt: now,
      expiresAt: now + TTL_MS,
      lastClearedAt: null,
      responses: [],
      emailHistory: [],
    };

    sessions.set(code, stored);
    saveStore();

    res.status(201).json({ session: toPublicSession(stored) });
  });

  // Fetch session by code
  app.get('/api/sessions/:code', (req, res) => {
    purgeExpired();
    const code = sanitizeText(req.params.code, 12).toUpperCase();
    const session = sessions.get(code);

    if (!session) {
      res.status(404).json({
        error: 'Session not found or expired after the 48-hour privacy window.',
        expiredOrMissing: true,
      });
      return;
    }

    res.json({ session: toPublicSession(session) });
  });

  // Update session customization (title, question, theme, email, settings)
  app.patch('/api/sessions/:code', (req, res) => {
    purgeExpired();
    const code = sanitizeText(req.params.code, 12).toUpperCase();
    const session = sessions.get(code);

    if (!session) {
      res.status(404).json({ error: 'Session not found or expired.' });
      return;
    }

    const body = (req.body || {}) as UpdateSessionInput;

    if (typeof body.title === 'string') {
      const nextTitle = sanitizeText(body.title, 120);
      if (nextTitle) session.title = nextTitle;
    }
    if (typeof body.question === 'string') {
      const nextQuestion = sanitizeText(body.question, 240);
      if (nextQuestion) session.question = nextQuestion;
    }
    if (typeof body.organizerEmail === 'string') {
      session.organizerEmail = sanitizeText(body.organizerEmail, 160);
    }
    if (body.theme && VALID_THEMES.includes(body.theme)) {
      session.theme = body.theme;
    }
    if (body.caseMode && VALID_CASE_MODES.includes(body.caseMode)) {
      session.caseMode = body.caseMode;
    }
    if (typeof body.colorBySentiment === 'boolean') {
      session.colorBySentiment = body.colorBySentiment;
    }
    if (typeof body.allowMultiple === 'boolean') {
      session.allowMultiple = body.allowMultiple;
    }
    if (typeof body.askName === 'boolean') {
      session.askName = body.askName;
    }
    if (typeof body.isLocked === 'boolean') {
      session.isLocked = body.isLocked;
    }

    saveStore();
    const publicSession = toPublicSession(session);
    broadcastToRoom(code, { type: 'session:updated', session: publicSession });

    res.json({ session: publicSession });
  });

  // Submit participant response(s)
  app.post('/api/sessions/:code/responses', (req, res) => {
    purgeExpired();
    const code = sanitizeText(req.params.code, 12).toUpperCase();
    const session = sessions.get(code);

    if (!session) {
      res.status(404).json({
        error: 'This session has expired after 48 hours or does not exist.',
      });
      return;
    }

    if (session.isLocked) {
      res.status(403).json({
        error: 'The organizer has paused new responses for this session.',
      });
      return;
    }

    const rawText = sanitizeText(req.body?.text, 160);
    if (!rawText) {
      res.status(400).json({ error: 'Please enter a word or short phrase.' });
      return;
    }

    const participantName = sanitizeText(req.body?.participantName, 60) || undefined;
    const sentiment: Sentiment = VALID_SENTIMENTS.includes(req.body?.sentiment as Sentiment)
      ? (req.body.sentiment as Sentiment)
      : 'neutral';
    const now = Date.now();

    // Support comma or newline separated entries (up to 5 per submission)
    const parts = rawText
      .split(/[\n,]+/)
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter((part) => part.length > 0)
      .slice(0, 5);

    if (parts.length === 0) {
      res.status(400).json({ error: 'Please enter a valid word or phrase.' });
      return;
    }

    const createdResponses: WordResponse[] = [];
    for (const part of parts) {
      const clipped = part.slice(0, 48);
      const responseItem: WordResponse = {
        id: crypto.randomUUID(),
        text: clipped,
        sentiment,
        participantName,
        createdAt: now,
        expiresAt: Math.min(now + TTL_MS, session.expiresAt),
      };
      session.responses.push(responseItem);
      createdResponses.push(responseItem);
    }

    saveStore();
    const publicSession = toPublicSession(session);
    broadcastToRoom(code, { type: 'session:updated', session: publicSession });

    res.status(201).json({
      added: createdResponses,
      session: publicSession,
    });
  });

  // Delete a single response (organizer moderation)
  app.delete('/api/sessions/:code/responses/:responseId', (req, res) => {
    purgeExpired();
    const code = sanitizeText(req.params.code, 12).toUpperCase();
    const responseId = sanitizeText(req.params.responseId, 80);
    const session = sessions.get(code);

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const nextResponses = session.responses.filter((r) => r.id !== responseId);
    if (nextResponses.length === session.responses.length) {
      res.status(404).json({ error: 'Response not found.' });
      return;
    }

    session.responses = nextResponses;
    saveStore();
    const publicSession = toPublicSession(session);
    broadcastToRoom(code, { type: 'session:updated', session: publicSession });

    res.json({ session: publicSession });
  });

  // Clear all responses immediately and restart the 48-hour freshness window
  app.post('/api/sessions/:code/clear', (req, res) => {
    purgeExpired();
    const code = sanitizeText(req.params.code, 12).toUpperCase();
    const session = sessions.get(code);

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const now = Date.now();
    session.responses = [];
    session.lastClearedAt = now;
    if (req.body?.resetWindow !== false) {
      session.expiresAt = now + TTL_MS;
    }

    saveStore();
    const publicSession = toPublicSession(session);
    broadcastToRoom(code, { type: 'session:updated', session: publicSession });

    res.json({ session: publicSession });
  });

  // Record sent review email in audit log
  app.post('/api/sessions/:code/email-log', (req, res) => {
    purgeExpired();
    const code = sanitizeText(req.params.code, 12).toUpperCase();
    const session = sessions.get(code);

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const recipient = sanitizeText(req.body?.recipient, 160);
    const subject = sanitizeText(req.body?.subject, 200);
    const responseCount = Number(req.body?.responseCount || 0);
    const method = req.body?.method === 'eml' ? 'eml' : 'gmail';

    if (!recipient) {
      res.status(400).json({ error: 'Recipient email is required.' });
      return;
    }

    const record: EmailRecord = {
      id: crypto.randomUUID(),
      recipient,
      subject: subject || `Word Cloud Responses: ${session.title}`,
      responseCount,
      sentAt: Date.now(),
      method,
    };

    session.emailHistory.unshift(record);
    session.emailHistory = session.emailHistory.slice(0, 20);
    saveStore();

    const publicSession = toPublicSession(session);
    broadcastToRoom(code, { type: 'session:updated', session: publicSession });

    res.status(201).json({ record, session: publicSession });
  });

  // Animate uploaded photo into video using Gemini Interactions API (gemini-omni-1.2-flash)
  app.post('/api/animate-video', async (req, res) => {
    req.setTimeout(310000);
    res.setTimeout(310000);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const rawImage = typeof req.body?.imageData === 'string' ? req.body.imageData.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim() : 'image/png';
    const aspectRatio = req.body?.aspectRatio === '9:16' ? '9:16' : '16:9';
    const promptInput = sanitizeText(req.body?.prompt, 400);

    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimeTypes.includes(mimeType)) {
      res.status(400).json({
        error: 'Unsupported image format. Please upload a PNG, JPEG, or WebP photo.',
      });
      return;
    }

    const base64Data = rawImage.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    if (!base64Data) {
      res.status(400).json({ error: 'Please upload a photo to animate.' });
      return;
    }

    const motionPrompt =
      promptInput ||
      'Animate this photo with smooth, natural cinematic motion while preserving subject identity, composition, and lighting.';

    try {
      const ai = new GoogleGenAI({ apiKey });
      const interaction = await ai.interactions.create(
        {
          model: 'gemini-omni-1.2-flash',
          input: [
            {
              type: 'image',
              mime_type: mimeType,
              data: base64Data,
            },
            {
              type: 'text',
              text: motionPrompt,
            },
          ],
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: aspectRatio,
          },
        },
        { timeout: 300000 }
      );

      let videoData = interaction.output_video?.data;
      let videoMimeType = interaction.output_video?.mime_type || 'video/mp4';
      let videoUri = interaction.output_video?.uri;

      if (!videoData && !videoUri && Array.isArray(interaction.steps)) {
        for (const step of interaction.steps) {
          if (step.type === 'model_output' && Array.isArray(step.content)) {
            const vidContent = step.content.find((c) => c.type === 'video') as
              | { data?: string; uri?: string; mime_type?: string }
              | undefined;
            if (vidContent) {
              videoData = vidContent.data;
              videoUri = vidContent.uri;
              videoMimeType = vidContent.mime_type || videoMimeType;
              break;
            }
          }
        }
      }

      if (videoData) {
        res.json({
          videoBase64: videoData,
          mimeType: videoMimeType,
          aspectRatio,
        });
        return;
      }

      if (videoUri) {
        const fetched = await fetch(videoUri, {
          headers: { 'x-goog-api-key': apiKey },
        });
        if (!fetched.ok) {
          throw new Error(`Failed to fetch generated video asset (${fetched.status}).`);
        }
        const buf = Buffer.from(await fetched.arrayBuffer());
        res.json({
          videoBase64: buf.toString('base64'),
          mimeType: videoMimeType,
          aspectRatio,
        });
        return;
      }

      res.status(502).json({
        error: 'Video generation completed without returning a video output.',
      });
    } catch (err: unknown) {
      console.error('Video generation error:', err);
      const errObj = err as { status?: number; message?: string };
      const status = typeof errObj?.status === 'number' && errObj.status >= 400 ? errObj.status : 500;
      let message = errObj?.message || 'Failed to generate video with gemini-omni-1.2-flash.';
      if (status === 429 || status === 403) {
        message = `${message} (Note: gemini-omni-1.2-flash requires a billing-enabled GEMINI_API_KEY in Settings > Secrets.)`;
      }
      res.status(status).json({ error: message });
    }
  });

  // Downloadable Microsoft PowerPoint Content Add-in Manifest (.xml)
  app.get('/api/sessions/:code/powerpoint-manifest.xml', (req, res) => {
    purgeExpired();
    const code = sanitizeText(req.params.code, 12).toUpperCase();
    const session = sessions.get(code);

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const rawOrigin =
      typeof req.query.origin === 'string' && req.query.origin.trim()
        ? req.query.origin.trim()
        : process.env.APP_URL || `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
    const cleanOrigin = rawOrigin.replace(/\/+$/, '');

    const params = new URLSearchParams();
    params.set('embed', code);
    if (req.query.qr === 'corner' || req.query.qr === 'none') {
      params.set('qr', req.query.qr);
    }
    if (typeof req.query.theme === 'string' && VALID_THEMES.includes(req.query.theme as CloudTheme)) {
      params.set('theme', req.query.theme);
    }

    const sourceUrl = `${cleanOrigin}/?${params.toString()}`;
    const hash = crypto.createHash('md5').update(`lexicon-live-${code}`).digest('hex');
    const guid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const displayName = session ? `Lexicon Live — ${session.title.slice(0, 48)}` : `Lexicon Live (${code})`;

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<OfficeApp
  xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:type="ContentApp">
  <Id>${guid}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Lexicon Live</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="${escapeXml(displayName)}"/>
  <Description DefaultValue="Live QR-scannable word cloud slide output embedded in PowerPoint."/>
  <AppDomains>
    <AppDomain>${escapeXml(cleanOrigin)}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Presentation"/>
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="${escapeXml(sourceUrl)}"/>
    <RequestedWidth>960</RequestedWidth>
    <RequestedHeight>540</RequestedHeight>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
</OfficeApp>
`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lexicon-live-${code.toLowerCase()}.xml"`
    );
    res.send(xml);
  });

  // Vite dev middleware vs static production build
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Lexicon Live server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
