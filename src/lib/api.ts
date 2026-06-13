// ─── Client API layer ───────────────────────────────────────────────────────

import type {
  JudgeReview,
  Participant,
  Phase,
  ProviderId,
  Turn,
} from '../types';
import { getKey } from './storage';

function keyHeader(provider: ProviderId): Record<string, string> {
  const key = getKey(provider);
  return key ? { 'X-Provider-Key': key } : {};
}

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export interface HealthInfo {
  ok: boolean;
  uptimeSeconds: number;
  serverKeys: Record<ProviderId, boolean>;
}

export async function fetchHealth(): Promise<HealthInfo> {
  return jsonOrThrow(await fetch('/api/health'));
}

export async function fetchModels(provider: ProviderId): Promise<string[]> {
  const res = await fetch(`/api/models?provider=${provider}`, {
    headers: keyHeader(provider),
  });
  const body = await jsonOrThrow(res);
  return body.models ?? [];
}

export async function testKey(provider: ProviderId): Promise<number> {
  const res = await fetch('/api/test-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeader(provider) },
    body: JSON.stringify({ provider }),
  });
  const body = await jsonOrThrow(res);
  return body.modelCount ?? 0;
}

// Wire formats expected by the server prompt builders
function wireParticipant(p: Participant) {
  return {
    id: p.id,
    displayName: p.displayName,
    model: p.model,
    provider: p.provider,
    stance: p.stance,
  };
}

function wireTranscript(turns: Turn[], participants: Participant[]) {
  const names = new Map(participants.map((p) => [p.id, p.displayName]));
  return turns
    .filter((t) => t.text.trim())
    .map((t) => ({
      kind: t.kind,
      participantId: t.participantId,
      speakerName: t.participantId ? names.get(t.participantId) : undefined,
      phase: t.phase,
      text: t.text,
    }));
}

/** Streams one debate turn. Resolves with the full text once complete. */
export async function streamTurn(args: {
  topic: string;
  speaker: Participant;
  participants: Participant[];
  phase: Phase;
  turns: Turn[];
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { topic, speaker, participants, phase, turns, onDelta, signal } = args;

  const res = await fetch('/api/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeader(speaker.provider) },
    body: JSON.stringify({
      provider: speaker.provider,
      model: speaker.model,
      topic,
      phase,
      speaker: wireParticipant(speaker),
      participants: participants.map(wireParticipant),
      transcript: wireTranscript(turns, participants),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Turn request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n');
    buffer = blocks.pop() ?? '';
    for (const raw of blocks) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const event = JSON.parse(payload);
      if (event.error) throw new Error(event.error);
      if (event.delta) {
        full += event.delta;
        onDelta(event.delta);
      }
      if (event.done) return full;
    }
  }
  if (!full.trim()) throw new Error('The stream ended before any content arrived.');
  return full;
}

export async function requestJudgeReview(args: {
  judgeProvider: ProviderId;
  judgeModel: string;
  topic: string;
  speaker: Participant;
  speech: string;
  participants: Participant[];
  turns: Turn[];
}): Promise<JudgeReview> {
  const res = await fetch('/api/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeader(args.judgeProvider) },
    body: JSON.stringify({
      provider: args.judgeProvider,
      model: args.judgeModel,
      topic: args.topic,
      speaker: wireParticipant(args.speaker),
      speech: args.speech,
      transcript: wireTranscript(args.turns, args.participants),
    }),
  });
  const body = await jsonOrThrow(res);
  return body.review as JudgeReview;
}

export async function requestVerdict(args: {
  judgeProvider: ProviderId;
  judgeModel: string;
  topic: string;
  participants: Participant[];
  turns: Turn[];
}): Promise<{ winnerId: string | 'tie'; reasoning: string }> {
  const res = await fetch('/api/verdict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeader(args.judgeProvider) },
    body: JSON.stringify({
      provider: args.judgeProvider,
      model: args.judgeModel,
      topic: args.topic,
      participants: args.participants.map(wireParticipant),
      transcript: wireTranscript(args.turns, args.participants),
    }),
  });
  return jsonOrThrow(res);
}
