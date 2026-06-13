// ─── Unified AI provider layer ──────────────────────────────────────────────
// Every provider is reached through plain fetch with native streaming.
// No SDK lock-in, no silent fallbacks: if a call fails, the error surfaces.

import type { ProviderId } from '../src/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class ProviderError extends Error {
  status: number;
  provider: ProviderId;
  constructor(provider: ProviderId, status: number, message: string) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

// OpenAI-compatible chat-completions endpoints
const OPENAI_COMPAT_BASE: Partial<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const ENV_KEYS: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** Header key (user-supplied, per request) wins; server env key is fallback. */
export function resolveKey(provider: ProviderId, headerKey?: string): string {
  const key = headerKey?.trim() || process.env[ENV_KEYS[provider]]?.trim();
  if (!key) {
    throw new ProviderError(
      provider,
      401,
      `No API key for ${provider}. Add one in Settings (sent per-request, never stored on the server) or set ${ENV_KEYS[provider]} in the server environment.`
    );
  }
  return key;
}

export function envKeyStatus(): Record<ProviderId, boolean> {
  const out = {} as Record<ProviderId, boolean>;
  (Object.keys(ENV_KEYS) as ProviderId[]).forEach((p) => {
    out[p] = Boolean(process.env[ENV_KEYS[p]]?.trim());
  });
  return out;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json?.error?.message || json?.message || text.slice(0, 400);
    } catch {
      return text.slice(0, 400);
    }
  } catch {
    return res.statusText;
  }
}

// ─── SSE line parser shared by all streaming adapters ───────────────────────

async function consumeSse(
  res: Response,
  onData: (payload: string) => void
): Promise<void> {
  if (!res.body) throw new Error('Response body is not readable.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload && payload !== '[DONE]') onData(payload);
    }
  }
}

// ─── Streaming chat: returns the full text, emitting deltas as they arrive ──

export async function streamChat(
  provider: ProviderId,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  maxTokens = 1200,
  signal?: AbortSignal
): Promise<string> {
  if (provider === 'anthropic') {
    return streamAnthropic(model, apiKey, messages, onDelta, maxTokens, signal);
  }
  if (provider === 'google') {
    return streamGoogle(model, apiKey, messages, onDelta, maxTokens, signal);
  }
  return streamOpenAiCompat(provider, model, apiKey, messages, onDelta, maxTokens, signal);
}

async function streamOpenAiCompat(
  provider: ProviderId,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  maxTokens: number,
  signal?: AbortSignal
): Promise<string> {
  const base = OPENAI_COMPAT_BASE[provider];
  if (!base) throw new ProviderError(provider, 400, `Provider ${provider} is not OpenAI-compatible.`);

  const body: Record<string, unknown> = { model, messages, stream: true };
  // Newer OpenAI models reject max_tokens in favor of max_completion_tokens.
  if (provider === 'openai') body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['X-Title'] = 'AI Debate Arena';
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ProviderError(provider, res.status, await readErrorBody(res));

  let full = '';
  await consumeSse(res, (payload) => {
    try {
      const json = JSON.parse(payload);
      const delta: string | undefined = json?.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    } catch {
      /* keep-alive / non-JSON lines are fine to skip */
    }
  });
  return full;
}

async function streamAnthropic(
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  maxTokens: number,
  signal?: AbortSignal
): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: turns,
      stream: true,
    }),
    signal,
  });
  if (!res.ok) throw new ProviderError('anthropic', res.status, await readErrorBody(res));

  let full = '';
  await consumeSse(res, (payload) => {
    try {
      const json = JSON.parse(payload);
      if (json?.type === 'content_block_delta' && json?.delta?.type === 'text_delta') {
        full += json.delta.text;
        onDelta(json.delta.text);
      }
    } catch {
      /* skip */
    }
  });
  return full;
}

async function streamGoogle(
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  maxTokens: number,
  signal?: AbortSignal
): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    signal,
  });
  if (!res.ok) throw new ProviderError('google', res.status, await readErrorBody(res));

  let full = '';
  await consumeSse(res, (payload) => {
    try {
      const json = JSON.parse(payload);
      const parts = json?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part?.text === 'string' && part.text) {
            full += part.text;
            onDelta(part.text);
          }
        }
      }
    } catch {
      /* skip */
    }
  });
  return full;
}

// ─── Non-streaming completion (used for judge / verdict calls) ──────────────

export async function completeChat(
  provider: ProviderId,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  maxTokens = 1600
): Promise<string> {
  let full = '';
  await streamChat(provider, model, apiKey, messages, (d) => (full += d), maxTokens);
  return full;
}

// ─── Live model listing so the catalog never goes stale ─────────────────────

export async function listModels(provider: ProviderId, apiKey: string): Promise<string[]> {
  if (provider === 'google') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) throw new ProviderError('google', res.status, await readErrorBody(res));
    const json = await res.json();
    return (json?.models ?? [])
      .filter((m: any) =>
        (m?.supportedGenerationMethods ?? []).some((g: string) => g.includes('generateContent'))
      )
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .sort();
  }

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) throw new ProviderError('anthropic', res.status, await readErrorBody(res));
    const json = await res.json();
    return (json?.data ?? []).map((m: any) => String(m.id)).sort();
  }

  const base = OPENAI_COMPAT_BASE[provider];
  if (!base) throw new ProviderError(provider, 400, `Unknown provider: ${provider}`);
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new ProviderError(provider, res.status, await readErrorBody(res));
  const json = await res.json();
  return (json?.data ?? []).map((m: any) => String(m.id)).sort();
}
