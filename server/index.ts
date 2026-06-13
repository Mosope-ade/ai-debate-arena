// ─── AI Debate Arena server ─────────────────────────────────────────────────
// Express app that proxies provider calls. API keys arrive per-request in the
// X-Provider-Key header (user-supplied, kept in the user's browser) or come
// from server environment variables. Keys are never logged or persisted here.

import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {
  streamChat,
  completeChat,
  listModels,
  resolveKey,
  envKeyStatus,
  ProviderError,
} from './providers';
import {
  buildSpeechMessages,
  buildJudgeMessages,
  buildVerdictMessages,
  parseJsonLoose,
  WireParticipant,
  WireTurn,
} from './prompts';
import type { JudgeReview, ProviderId, TurnScores, FallacyFlag } from '../src/types';

dotenv.config();

const VALID_PROVIDERS = new Set<string>([
  'openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'openrouter',
]);

const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*'),
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '2mb' }));

// Security headers for production static responses
app.use((_req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self' https:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  next();
});

const turnLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
const judgeLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false });
const verdictLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const modelsLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

const PORT = Number(process.env.PORT) || 3000;
const startedAt = Date.now();

const STREAM_TIMEOUT_MS = 120_000;

function headerKey(req: express.Request): string | undefined {
  const v = req.header('x-provider-key');
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function sendError(res: express.Response, err: unknown) {
  if (err instanceof ProviderError) {
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: err.message,
      provider: err.provider,
    });
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  return res.status(500).json({ error: message });
}

// ─── Health & configuration ─────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    serverKeys: envKeyStatus(), // booleans only — never the keys themselves
  });
});

// ─── Live model catalog ──────────────────────────────────────────────────────

app.get('/api/models', modelsLimiter, async (req, res) => {
  try {
    const provider = String(req.query.provider);
    if (!VALID_PROVIDERS.has(provider)) return res.status(400).json({ error: 'Unknown provider.' });
    const key = resolveKey(provider as ProviderId, headerKey(req));
    const models = await listModels(provider as ProviderId, key);
    res.json({ models });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Key / connection test ───────────────────────────────────────────────────

app.post('/api/test-key', modelsLimiter, async (req, res) => {
  try {
    const provider = String(req.body?.provider);
    if (!VALID_PROVIDERS.has(provider)) return res.status(400).json({ error: 'Unknown provider.' });
    const key = resolveKey(provider as ProviderId, headerKey(req));
    const models = await listModels(provider as ProviderId, key);
    res.json({ ok: true, modelCount: models.length });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Debate turn: real token streaming over SSE ──────────────────────────────

app.post('/api/turn', turnLimiter, async (req, res) => {
  const { provider, model, topic, speaker, participants, transcript } = req.body as {
    provider: string;
    model: string;
    topic: string;
    speaker: WireParticipant;
    participants: WireParticipant[];
    transcript: WireTurn[];
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  req.on('close', () => abort.abort());
  const timeoutId = setTimeout(() => abort.abort(), STREAM_TIMEOUT_MS);

  try {
    if (!topic || !speaker || !model || !provider) {
      throw new Error('Missing required fields: provider, model, topic, speaker.');
    }
    if (!VALID_PROVIDERS.has(provider)) {
      throw new Error('Unknown provider.');
    }
    const key = resolveKey(provider as ProviderId, headerKey(req));
    const messages = buildSpeechMessages({
      topic,
      speaker,
      participants,
      phase: (req.body.phase ?? 'opening'),
      transcript: transcript ?? [],
    });

    const full = await streamChat(
      provider as ProviderId,
      model,
      key,
      messages,
      (delta) => send({ delta }),
      1400,
      abort.signal
    );

    if (!full.trim()) {
      throw new ProviderError(provider as ProviderId, 502, `${provider}/${model} returned an empty response.`);
    }
    send({ done: true });
  } catch (err) {
    if (!abort.signal.aborted) {
      const message =
        err instanceof ProviderError
          ? `[${err.provider} ${err.status}] ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Turn generation failed.';
      send({ error: message });
    }
  } finally {
    clearTimeout(timeoutId);
    res.end();
  }
});

// ─── Independent judge review of a single speech ─────────────────────────────

const FALLACY_TYPES = new Set([
  'Strawman',
  'Ad Hominem',
  'False Dilemma',
  'Circular Reasoning',
  'Slippery Slope',
  'Appeal to Authority',
  'Hasty Generalization',
]);

function clampScore(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function sanitizeReview(raw: any, speech: string): JudgeReview {
  const scores: TurnScores = {
    logic: clampScore(raw?.scores?.logic),
    evidence: clampScore(raw?.scores?.evidence),
    relevance: clampScore(raw?.scores?.relevance),
    persuasiveness: clampScore(raw?.scores?.persuasiveness),
    consistency: clampScore(raw?.scores?.consistency),
  };
  const fallacies: FallacyFlag[] = Array.isArray(raw?.fallacies)
    ? raw.fallacies
        .filter((f: any) => f && FALLACY_TYPES.has(f.type) && typeof f.quote === 'string')
        // The quote must actually appear in the speech — rejects invented flags.
        .filter((f: any) => speech.toLowerCase().includes(String(f.quote).toLowerCase().slice(0, 60)))
        .map((f: any) => ({
          type: f.type,
          quote: String(f.quote).slice(0, 300),
          explanation: String(f.explanation ?? '').slice(0, 500),
        }))
    : [];
  return {
    claim: String(raw?.claim ?? '').slice(0, 140) || 'Unlabeled claim',
    scores,
    fallacies,
    commentary: String(raw?.commentary ?? '').slice(0, 600),
  };
}

app.post('/api/judge', judgeLimiter, async (req, res) => {
  try {
    const { provider, model, topic, speaker, speech, transcript } = req.body as {
      provider: string;
      model: string;
      topic: string;
      speaker: WireParticipant;
      speech: string;
      transcript: WireTurn[];
    };
    if (!speech?.trim()) throw new Error('No speech text to judge.');
    if (!VALID_PROVIDERS.has(provider)) return res.status(400).json({ error: 'Unknown provider.' });
    const key = resolveKey(provider as ProviderId, headerKey(req));
    const raw = await completeChat(
      provider as ProviderId,
      model,
      key,
      buildJudgeMessages({ topic, speaker, speech, transcript: transcript ?? [] }),
      1600
    );
    const review = sanitizeReview(parseJsonLoose(raw), speech);
    res.json({ review });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Final verdict from the AI judge ─────────────────────────────────────────

app.post('/api/verdict', verdictLimiter, async (req, res) => {
  try {
    const { provider, model, topic, participants, transcript } = req.body as {
      provider: string;
      model: string;
      topic: string;
      participants: WireParticipant[];
      transcript: WireTurn[];
    };
    if (!VALID_PROVIDERS.has(provider)) return res.status(400).json({ error: 'Unknown provider.' });
    const key = resolveKey(provider as ProviderId, headerKey(req));
    const raw = await completeChat(
      provider as ProviderId,
      model,
      key,
      buildVerdictMessages({ topic, participants, transcript: transcript ?? [] }),
      1200
    );
    const parsed = parseJsonLoose<{ winnerIndex: number; reasoning: string }>(raw);
    const idx = Number(parsed.winnerIndex);
    const winnerId =
      Number.isInteger(idx) && idx >= 0 && idx < participants.length
        ? participants[idx].id
        : 'tie';
    res.json({ winnerId, reasoning: String(parsed.reasoning ?? '').slice(0, 1500) });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Suggest stances for a given topic ──────────────────────────────────────

app.post('/api/suggest-stances', modelsLimiter, async (req, res) => {
  try {
    const { topic, provider } = req.body as { topic: string; provider: string };
    if (!topic?.trim()) return res.status(400).json({ error: 'No topic provided.' });
    if (!VALID_PROVIDERS.has(provider)) return res.status(400).json({ error: 'Unknown provider.' });
    const key = resolveKey(provider as ProviderId, headerKey(req));
    const raw = await completeChat(
      provider as ProviderId,
      req.body.model ?? 'claude-haiku-4-5',
      key,
      [
        {
          role: 'system',
          content: 'You generate debate positions. Return ONLY a valid JSON array of strings. No preamble, no markdown fences.',
        },
        {
          role: 'user',
          content: `Generate 4 distinct, interesting positions someone could argue in a debate about: "${topic.slice(0, 500)}". Make them specific and argumentatively rich, not just "for" and "against".`,
        },
      ],
      300
    );
    const stances = parseJsonLoose<string[]>(raw);
    if (!Array.isArray(stances)) throw new Error('Model did not return an array.');
    res.json(stances.slice(0, 4).map((s: unknown) => String(s).slice(0, 200)));
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Static hosting / Vite dev middleware ────────────────────────────────────

async function initializeServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite development middleware attached.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
    console.log('Serving production build from /dist.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Debate Arena listening on http://0.0.0.0:${PORT}`);
  });
}

initializeServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
