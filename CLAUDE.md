# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install deps (Node.js 20+ required)
npm run dev          # start dev server at http://localhost:3000 (Express + Vite middleware)
npm run build        # compile client to dist/, server to dist-server/server.cjs
npm start            # run production build on $PORT (default 3000)
npm run lint         # TypeScript type-check only (tsc --noEmit); no separate test suite
npm run clean        # remove dist/ and dist-server/
```

There are no automated tests. `npm run lint` is the only static-analysis gate.

## Architecture

Single Node process: Express serves both the `/api/*` routes and the Vite-built React SPA. In dev, Vite runs as Express middleware (HMR included). In production, Express serves `dist/` as static files.

### Server (`server/`)

| File | Purpose |
|---|---|
| `index.ts` | Express routes: `/api/health`, `/api/models`, `/api/test-key`, `/api/turn` (SSE), `/api/judge`, `/api/verdict` |
| `providers.ts` | Unified AI provider layer — plain `fetch`, no SDKs. OpenAI-compat (OpenAI, xAI, DeepSeek, Mistral, OpenRouter), plus dedicated adapters for Anthropic Messages API and Google Gemini. `resolveKey()` picks the per-request header key over the server env key. |
| `prompts.ts` | Prompt builders for speeches, judge reviews, and verdicts. Defines wire types `WireParticipant` / `WireTurn` used in API request bodies. |

**Key invariant in `providers.ts`:** API keys arrive in the `X-Provider-Key` request header (from the user's browser localStorage) or from server env vars — the header key always wins. Keys are never logged or stored. `ProviderError` surfaces the provider's actual HTTP status and message; there are no silent fallbacks.

**`/api/turn` is SSE.** The endpoint streams `{ delta }` events token-by-token and ends with `{ done: true }` or `{ error }`. The client reads this as an SSE stream in `src/lib/api.ts::streamTurn`.

**Judge validation (`index.ts:sanitizeReview`):** Fallacy flags from the judge model are server-validated — the quoted text must appear verbatim in the speech (case-insensitive, first 60 chars), and the fallacy type must be one of the seven known `FALLACY_TYPES`. Invalid flags are dropped.

### Client (`src/`)

| File/Dir | Purpose |
|---|---|
| `types.ts` | All shared domain types and the `buildSchedule()` function — imported by both server and client |
| `App.tsx` | Root state machine: holds the active `Session`, `streaming` buffer, judge state, and autoplay flag; orchestrates all side effects |
| `lib/api.ts` | Typed wrappers for all server endpoints. `streamTurn` reads the SSE stream directly. |
| `lib/storage.ts` | `localStorage` access for API keys (per-provider) and completed session history |
| `lib/exports.ts` | Markdown, JSON, and print/PDF export from a `Session` |
| `lib/ui.ts` | Color token helpers for participant colors and provider badges |
| `components/Setup.tsx` | Debate configuration form: topic, participants, judge, round count |
| `components/Debate.tsx` | Live debate view: transcript, moderator controls, score display; receives all session state from `App.tsx` as props |
| `components/ArgumentGraph.tsx` | React Flow graph of turn claims, laid out in response order |
| `components/Analytics.tsx` | Score-over-time chart, per-category radar, participation stats, fallacy log |
| `components/KeysModal.tsx` | Per-provider key input, test, and server-key status display |

### Shared invariant: deterministic speaking order

`buildSchedule(config)` in `src/types.ts` is a pure function that returns the full ordered list of `ScheduleSlot`s. The next speaker is always `schedule[speechTurns(turns).length]` — a model never decides whose turn it is. This function is used by both `App.tsx` (to advance turns) and `Debate.tsx` (to show who speaks next).

### Provider IDs and env vars

The seven supported `ProviderId` values map to env vars:

| Provider | Env var |
|---|---|
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |

Copy `.env.example` to `.env` for local server-side keys. Browser keys (entered in the KeysModal) take precedence and are the primary mode for personal use.

## Path alias

`@/*` resolves to the repo root (configured in both `tsconfig.json` and `vite.config.ts`). Use `@/server/...` or `@/src/...` for absolute imports.
