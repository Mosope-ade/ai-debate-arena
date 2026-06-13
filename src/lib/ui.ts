// ─── Shared UI tokens ───────────────────────────────────────────────────────

import type { ParticipantColor, ProviderId } from '../types';

export const PARTICIPANT_COLORS: ParticipantColor[] = ['indigo', 'rose', 'emerald', 'amber'];

export const colorClasses: Record<
  ParticipantColor,
  { text: string; border: string; bg: string; soft: string; hex: string }
> = {
  indigo: {
    text: 'text-indigo-300',
    border: 'border-indigo-500/50',
    bg: 'bg-indigo-500',
    soft: 'bg-indigo-500/10',
    hex: '#818cf8',
  },
  rose: {
    text: 'text-rose-300',
    border: 'border-rose-500/50',
    bg: 'bg-rose-500',
    soft: 'bg-rose-500/10',
    hex: '#fb7185',
  },
  emerald: {
    text: 'text-emerald-300',
    border: 'border-emerald-500/50',
    bg: 'bg-emerald-500',
    soft: 'bg-emerald-500/10',
    hex: '#34d399',
  },
  amber: {
    text: 'text-amber-300',
    border: 'border-amber-500/50',
    bg: 'bg-amber-500',
    soft: 'bg-amber-500/10',
    hex: '#fbbf24',
  },
};

export const providerBadge: Record<ProviderId, string> = {
  openai: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  anthropic: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  google: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  xai: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  deepseek: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  mistral: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  openrouter: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};

export function formatDuration(ms?: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
