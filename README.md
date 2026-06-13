# AI Debate Arena

Watch real AI models debate each other — live. Pick a topic, assign positions to models from different providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, OpenRouter), and judge the clash. Every argument is generated live by the actual model over its real API. **Nothing is simulated.**

## Features

- **True multi-model debates** — each debater is a different model from any of 7 providers, streaming its arguments token by token over SSE. 2–4 debaters per match.
- **Structured rounds** — opening statements → 1–3 rebuttal rounds → optional cross-examination → closing arguments, with a deterministic speaking order (never decided by a model).
- **Independent AI judge** — a separate model (your choice) scores every speech on logic, evidence, relevance, persuasiveness, and consistency; flags genuine logical fallacies with exact quotes (server-verified against the speech text); and can deliver the final verdict with reasoning.
- **You are the moderator** — interject questions mid-debate (the next speaker must address them), award or deduct points, highlight strong arguments, and call the winner yourself.
- **Shareable debate links** — copy a link from any debate (in progress or completed) and share it. The full session is encoded into the URL hash using gzip + base64 — no server storage required, fully read-only for the recipient.
- **AI stance suggestions** — click "Suggest stances" in setup to have a model generate four distinct, argumentatively rich positions for your topic.
- **Argument map** — a live React Flow graph of each speech's core claim, linked in response order.
- **Analytics** — score progression, per-category radar, participation stats, fallacy log.
- **Exports** — Markdown, JSON, and print-ready PDF transcripts.
- **Local history** — completed debates are saved in your browser and can be reopened or shared directly from the history list.
- **Live model catalogs** — model lists are fetched from each provider's `/models` endpoint with your key, so they never go stale.
- **Honest failures** — if a provider call fails, you see the provider's actual error and a retry button. There are no silent fallbacks to a different model.

## Quick start (local)

Prerequisites: Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the app, click **API keys**, paste a key for at least one provider (an OpenRouter key alone unlocks models from most vendors), hit **Test**, then start a debate.

## API key security model

There are two ways keys can reach a provider, and you can mix them:

| Mode | How | Best for |
|---|---|---|
| **Browser keys** | Each user pastes their own keys in *Settings → API keys*. Keys live in that browser's `localStorage` only and are sent per-request in an `X-Provider-Key` header. The server uses them transiently and never stores or logs them. | Personal use, demos, multi-tenant deployments where users bring their own keys. |
| **Server keys** | Set environment variables (see `.env.example`). Used automatically whenever a request arrives without a browser key for that provider. | Internal team deployments with shared billing. Put the app behind your auth proxy / VPN. |

> If you expose a deployment with server keys publicly, anyone can spend your credits. Always gate such deployments behind authentication (e.g. Cloudflare Access, an OAuth proxy, or your VPN).

For shared/public deployments, set `ALLOWED_ORIGIN` to your frontend's URL to restrict which origins the API accepts:

```
ALLOWED_ORIGIN=https://your-domain.com
```

If unset, the server blocks all cross-origin requests in production.

## Production build

```bash
npm run build        # client → dist/, server → dist-server/server.cjs
npm start            # serves both on $PORT (default 3000)
```

## Deploy

**Docker**

```bash
docker build -t debate-arena .
docker run -p 3000:3000 --env-file .env debate-arena
```

**Fly.io (recommended free tier)** — persistent process, no sleep, handles long-lived SSE connections:

```bash
npm i -g flyctl
flyctl auth signup
flyctl launch        # detects the Dockerfile automatically
flyctl deploy
flyctl secrets set ALLOWED_ORIGIN=https://your-app.fly.dev OPENROUTER_API_KEY=...
```

**Render** — simpler setup; note that free instances sleep after 15 minutes of inactivity, which closes any active SSE streams:

Point the service at this repo, set build command `npm run build`, start command `npm start`, and add provider env vars.

**Railway / VPS** — `npm ci && npm run build`, then run `npm start` under a process manager (`pm2 start npm -- start`) behind nginx/Caddy.

> **SSE and serverless:** `/api/turn` holds an open connection for the duration of each speech (typically 30–60 s). Serverless platforms with short function timeouts (e.g. Vercel Hobby's 10 s limit) are not suitable.

### Rate limits

The server enforces per-IP rate limits (rolling 60-second window):

| Endpoint | Limit |
|---|---|
| `/api/turn` | 20 req/min |
| `/api/judge` | 40 req/min |
| `/api/verdict` | 10 req/min |
| `/api/models`, `/api/test-key`, `/api/suggest-stances` | 30 req/min |

If you run the server behind a reverse proxy, set `app.set('trust proxy', 1)` so limits apply to the real client IP rather than the proxy address.

## Architecture

```
server/
  index.ts       Express app: /api/health, /api/models, /api/test-key,
                 /api/turn (SSE token stream), /api/judge, /api/verdict,
                 /api/suggest-stances
  providers.ts   Unified provider layer (plain fetch, native streaming):
                 OpenAI-compatible (OpenAI, xAI, DeepSeek, Mistral, OpenRouter),
                 Anthropic Messages API, Google Gemini API
  prompts.ts     Prompt builders for speeches, judge reviews, verdicts
src/
  types.ts       Shared domain model + deterministic schedule builder
  lib/           api (SSE client), storage (keys/sessions), exports (incl. share link), ui tokens
  components/    Setup, Debate, ArgumentGraph, Analytics, KeysModal, ShareView
  main.tsx       Root: routes #share= URLs to the read-only ShareView before App mounts
```

Design decisions worth knowing:

- **Speaker order is computed, never inferred.** The schedule is a pure function of the config; the next speaker is `schedule[speechesSoFar]`. A model can never mis-attribute a turn.
- **Judging is independent.** The judge is a separate model in a separate call that never writes speeches. Fallacy flags must quote the speech verbatim — the server rejects flags whose quotes don't appear in the text.
- **Streaming is real.** `/api/turn` re-emits provider tokens over SSE as they arrive. No typewriter theatrics.
- **Share links are serverless.** The full session is gzip-compressed and base64-encoded into the URL hash. The server never touches it; the recipient's browser decodes it entirely client-side.

## Notes & limits

- Saved debates and keys live in the browser (`localStorage`); clearing site data removes them. Export anything you want to keep.
- Share links encode the full session into the URL. Very long debates produce long URLs; most browsers handle up to ~8 KB in a hash without issue.
- PDF export uses the browser's print dialog (allow pop-ups).
- Provider/model availability changes frequently; the model dropdowns are fetched live, and you can also type any model ID supported by your provider.
