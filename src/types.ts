// ─── Shared domain types ────────────────────────────────────────────────────

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'openrouter';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  keyName: string; // env var name used server-side
  keyUrl: string; // where to obtain a key
  defaultModels: string[]; // fallback presets if live listing fails
}

export type Phase = 'opening' | 'rebuttal' | 'crossfire' | 'closing';

export const PHASE_LABELS: Record<Phase, string> = {
  opening: 'Opening statements',
  rebuttal: 'Rebuttals',
  crossfire: 'Cross-examination',
  closing: 'Closing arguments',
};

export interface Participant {
  id: string;
  provider: ProviderId;
  model: string;
  displayName: string;
  stance: string; // the position this model argues
  color: ParticipantColor;
}

export type ParticipantColor = 'indigo' | 'rose' | 'emerald' | 'amber';

export interface TurnScores {
  logic: number;
  evidence: number;
  relevance: number;
  persuasiveness: number;
  consistency: number;
}

export const SCORE_CATEGORIES: (keyof TurnScores)[] = [
  'logic',
  'evidence',
  'relevance',
  'persuasiveness',
  'consistency',
];

export type FallacyType =
  | 'Strawman'
  | 'Ad Hominem'
  | 'False Dilemma'
  | 'Circular Reasoning'
  | 'Slippery Slope'
  | 'Appeal to Authority'
  | 'Hasty Generalization';

export interface FallacyFlag {
  type: FallacyType;
  quote: string;
  explanation: string;
}

export interface JudgeReview {
  claim: string; // one-line summary of the turn's core claim
  scores: TurnScores;
  fallacies: FallacyFlag[];
  commentary: string;
}

export interface Turn {
  id: string;
  kind: 'speech' | 'moderator';
  participantId?: string; // present when kind === 'speech'
  phase: Phase;
  round: number; // 1-based rebuttal round; 0 for non-rebuttal phases
  text: string;
  judge?: JudgeReview;
  judgeError?: string;
  judgePending?: boolean;
  userPoints: number; // manual points awarded by the human judge
  highlighted: boolean;
  startedAt: number;
  durationMs?: number;
}

export interface JudgeConfig {
  enabled: boolean;
  provider: ProviderId;
  model: string;
}

export interface DebateConfig {
  topic: string;
  participants: Participant[];
  judge: JudgeConfig;
  rebuttalRounds: number; // 1–3
  crossfire: boolean;
}

export interface ScheduleSlot {
  participantId: string;
  phase: Phase;
  round: number;
}

export interface Verdict {
  winnerId: string | 'tie';
  reasoning: string;
  source: 'human' | 'ai';
}

export interface Session {
  id: string;
  createdAt: number;
  completedAt?: number;
  config: DebateConfig;
  turns: Turn[];
  status: 'live' | 'completed';
  verdict?: Verdict;
}

// ─── Helpers shared by client and server ───────────────────────────────────

/** Deterministic speaking schedule. The next speaker is always
 *  schedule[number of speech turns so far] — never decided by a model. */
export function buildSchedule(config: DebateConfig): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  const ids = config.participants.map((p) => p.id);
  for (const id of ids) slots.push({ participantId: id, phase: 'opening', round: 0 });
  for (let r = 1; r <= config.rebuttalRounds; r++) {
    for (const id of ids) slots.push({ participantId: id, phase: 'rebuttal', round: r });
  }
  if (config.crossfire) {
    for (const id of ids) slots.push({ participantId: id, phase: 'crossfire', round: 0 });
  }
  for (const id of ids) slots.push({ participantId: id, phase: 'closing', round: 0 });
  return slots;
}

export function speechTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.kind === 'speech');
}

export function turnTotal(t: Turn): number {
  if (!t.judge) return t.userPoints;
  const s = t.judge.scores;
  const avg = (s.logic + s.evidence + s.relevance + s.persuasiveness + s.consistency) / 5;
  return Math.round(avg) + t.userPoints;
}

export function participantTotals(session: Session): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const p of session.config.participants) totals[p.id] = 0;
  for (const t of speechTurns(session.turns)) {
    if (t.participantId) totals[t.participantId] = (totals[t.participantId] ?? 0) + turnTotal(t);
  }
  return totals;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    keyName: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyName: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModels: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'google',
    label: 'Google',
    keyName: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModels: ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'],
  },
  {
    id: 'xai',
    label: 'xAI',
    keyName: 'XAI_API_KEY',
    keyUrl: 'https://console.x.ai',
    defaultModels: ['grok-4.1-fast-reasoning', 'grok-4.20-reasoning'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    keyName: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    keyName: 'MISTRAL_API_KEY',
    keyUrl: 'https://console.mistral.ai/api-keys',
    defaultModels: ['mistral-large-latest', 'mistral-small-latest'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyName: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/settings/keys',
    defaultModels: [
      'openai/gpt-5.5',
      'anthropic/claude-sonnet-4.6',
      'google/gemini-3.5-flash',
      'deepseek/deepseek-chat-v3.1',
      'meta-llama/llama-4-maverick',
    ],
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
