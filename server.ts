import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import type {
  AggregatedWord,
  CaseMode,
  CloudTheme,
  CreateSessionInput,
  EmailRecord,
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

function aggregateWords(responses: WordResponse[], caseMode: CaseMode): AggregatedWord[] {
  const map = new Map<
    string,
    { variants: Map<string, number>; count: number; lastSubmittedAt: number }
  >();

  for (const res of responses) {
    const cleaned = res.text.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    const formatted = formatWordCase(cleaned, caseMode);

    let entry = map.get(key);
    if (!entry) {
      entry = { variants: new Map(), count: 0, lastSubmittedAt: res.createdAt };
      map.set(key, entry);
    }
    entry.count += 1;
    entry.lastSubmittedAt = Math.max(entry.lastSubmittedAt, res.createdAt);
    entry.variants.set(formatted, (entry.variants.get(formatted) || 0) + 1);
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
          item.responses = Array.isArray(item.responses)
            ? item.responses.filter((r) => now < r.expiresAt)
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
  app.use(express.json({ limit: '256kb' }));

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
