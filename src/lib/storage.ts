// ─── Browser-local persistence ──────────────────────────────────────────────
// API keys live ONLY in this browser's localStorage and are sent per-request.
// The server never stores them. For shared/multi-user deployments, configure
// keys via server environment variables instead (see README).

import type { ProviderId, Session } from '../types';

const KEYS_NS = 'debate-arena:keys';
const SESSIONS_NS = 'debate-arena:sessions';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ─── API keys ────────────────────────────────────────────────────────────────

export function getKeys(): Partial<Record<ProviderId, string>> {
  return readJson(KEYS_NS, {});
}

export function getKey(provider: ProviderId): string | undefined {
  return getKeys()[provider];
}

export function setKey(provider: ProviderId, key: string): void {
  const keys = getKeys();
  if (key.trim()) keys[provider] = key.trim();
  else delete keys[provider];
  localStorage.setItem(KEYS_NS, JSON.stringify(keys));
}

export function clearAllKeys(): void {
  localStorage.removeItem(KEYS_NS);
}

// ─── Saved sessions ──────────────────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  topic: string;
  createdAt: number;
  completedAt?: number;
  participantNames: string[];
  winnerName?: string;
}

const MAX_SAVED = 30;

export function listSessions(): SessionSummary[] {
  const sessions = readJson<Session[]>(SESSIONS_NS, []);
  return sessions
    .map((s) => ({
      id: s.id,
      topic: s.config.topic,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      participantNames: s.config.participants.map((p) => p.displayName),
      winnerName:
        s.verdict && s.verdict.winnerId !== 'tie'
          ? s.config.participants.find((p) => p.id === s.verdict!.winnerId)?.displayName
          : s.verdict
            ? 'Tie'
            : undefined,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function loadSession(id: string): Session | undefined {
  return readJson<Session[]>(SESSIONS_NS, []).find((s) => s.id === id);
}

export function saveSession(session: Session): void {
  const sessions = readJson<Session[]>(SESSIONS_NS, []).filter((s) => s.id !== session.id);
  sessions.unshift(session);
  try {
    localStorage.setItem(SESSIONS_NS, JSON.stringify(sessions.slice(0, MAX_SAVED)));
  } catch {
    // Quota exceeded — drop the oldest sessions and retry once.
    localStorage.setItem(SESSIONS_NS, JSON.stringify(sessions.slice(0, 5)));
  }
}

export function deleteSession(id: string): void {
  const sessions = readJson<Session[]>(SESSIONS_NS, []).filter((s) => s.id !== id);
  localStorage.setItem(SESSIONS_NS, JSON.stringify(sessions));
}
