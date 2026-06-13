// ─── Export utilities ───────────────────────────────────────────────────────

import { deflate, inflate } from 'pako';
import {
  participantTotals,
  PHASE_LABELS,
  Session,
  speechTurns,
  turnTotal,
} from '../types';

// ─── Share link encode / decode ──────────────────────────────────────────────

export function encodeSession(session: Session): string {
  const json = JSON.stringify(session);
  const compressed = deflate(json, { level: 9 });
  let binary = '';
  for (let i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  return btoa(binary);
}

export function decodeSession(encoded: string): Session {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const json = inflate(bytes, { to: 'string' });
  return JSON.parse(json) as Session;
}

export function buildShareUrl(session: Session): string {
  const encoded = encodeSession(session);
  return `${window.location.origin}${window.location.pathname}#share=${encoded}`;
}

function participantName(session: Session, id?: string): string {
  return session.config.participants.find((p) => p.id === id)?.displayName ?? 'Unknown';
}

export function sessionToMarkdown(session: Session): string {
  const { config, turns, verdict } = session;
  const totals = participantTotals(session);
  const lines: string[] = [];

  lines.push(`# AI Debate Arena — Transcript`);
  lines.push('');
  lines.push(`**Topic:** ${config.topic}`);
  lines.push(`**Date:** ${new Date(session.createdAt).toLocaleString()}`);
  lines.push('');
  lines.push(`## Participants`);
  for (const p of config.participants) {
    lines.push(`- **${p.displayName}** (${p.provider} / \`${p.model}\`) — argued: ${p.stance} — total score: ${totals[p.id] ?? 0}`);
  }
  if (config.judge.enabled) {
    lines.push(`- **AI Judge:** ${config.judge.provider} / \`${config.judge.model}\``);
  }
  lines.push('');

  if (verdict) {
    const winner = verdict.winnerId === 'tie' ? 'Tie' : participantName(session, verdict.winnerId);
    lines.push(`## Verdict (${verdict.source === 'ai' ? 'AI judge' : 'human judge'})`);
    lines.push(`**Winner:** ${winner}`);
    if (verdict.reasoning) lines.push(`\n${verdict.reasoning}`);
    lines.push('');
  }

  lines.push(`## Transcript`);
  lines.push('');
  for (const t of turns) {
    if (t.kind === 'moderator') {
      lines.push(`> **Moderator:** ${t.text}`);
      lines.push('');
      continue;
    }
    const name = participantName(session, t.participantId);
    lines.push(`### ${name} — ${PHASE_LABELS[t.phase]}${t.round ? ` (round ${t.round})` : ''}`);
    lines.push('');
    lines.push(t.text);
    lines.push('');
    if (t.judge) {
      const s = t.judge.scores;
      lines.push(
        `*Judge: logic ${s.logic} · evidence ${s.evidence} · relevance ${s.relevance} · persuasion ${s.persuasiveness} · consistency ${s.consistency} — turn total ${turnTotal(t)}*`
      );
      if (t.judge.commentary) lines.push(`*"${t.judge.commentary}"*`);
      for (const f of t.judge.fallacies) {
        lines.push(`- ⚠️ **${f.type}:** "${f.quote}" — ${f.explanation}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function download(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'debate';
}

export function exportMarkdown(session: Session) {
  download(`${slug(session.config.topic)}.md`, 'text/markdown', sessionToMarkdown(session));
}

export function exportJson(session: Session) {
  download(`${slug(session.config.topic)}.json`, 'application/json', JSON.stringify(session, null, 2));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Opens a print-optimized window; the browser's print dialog saves it as PDF. */
export function exportPdf(session: Session) {
  const { config, turns, verdict } = session;
  const totals = participantTotals(session);

  const turnsHtml = turns
    .map((t) => {
      if (t.kind === 'moderator') {
        return `<div class="moderator"><strong>Moderator:</strong> ${escapeHtml(t.text)}</div>`;
      }
      const name = escapeHtml(participantName(session, t.participantId));
      const judge = t.judge
        ? `<div class="judge">Judge — logic ${t.judge.scores.logic}, evidence ${t.judge.scores.evidence}, relevance ${t.judge.scores.relevance}, persuasion ${t.judge.scores.persuasiveness}, consistency ${t.judge.scores.consistency} (turn total ${turnTotal(t)})${
            t.judge.commentary ? `<br/><em>"${escapeHtml(t.judge.commentary)}"</em>` : ''
          }${t.judge.fallacies
            .map((f) => `<br/>⚠ ${escapeHtml(f.type)}: "${escapeHtml(f.quote)}"`)
            .join('')}</div>`
        : '';
      return `<div class="turn"><h3>${name} <span class="phase">${PHASE_LABELS[t.phase]}${
        t.round ? ` · round ${t.round}` : ''
      }</span></h3><p>${escapeHtml(t.text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>${judge}</div>`;
    })
    .join('');

  const winner = verdict
    ? verdict.winnerId === 'tie'
      ? 'Tie'
      : participantName(session, verdict.winnerId)
    : '—';

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>${escapeHtml(config.topic)} — AI Debate Arena</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a202c; max-width: 760px; margin: 40px auto; line-height: 1.55; padding: 0 24px; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  h3 { margin: 28px 0 6px; font-size: 16px; }
  .meta { color: #4a5568; font-size: 13px; margin-bottom: 18px; }
  .phase { color: #718096; font-weight: normal; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .participants, .verdict { border: 1px solid #e2e8f0; padding: 14px 18px; border-radius: 8px; margin: 14px 0; font-size: 14px; }
  .moderator { background: #f7fafc; border-left: 3px solid #a0aec0; padding: 8px 14px; margin: 18px 0; font-size: 14px; }
  .judge { font-size: 12px; color: #4a5568; border-top: 1px dashed #e2e8f0; margin-top: 8px; padding-top: 6px; }
  .turn p { margin: 8px 0; font-size: 14px; }
  @media print { body { margin: 10mm auto; } }
</style></head><body>
<h1>${escapeHtml(config.topic)}</h1>
<div class="meta">AI Debate Arena transcript · ${new Date(session.createdAt).toLocaleString()}</div>
<div class="participants"><strong>Participants</strong><br/>${config.participants
    .map(
      (p) =>
        `${escapeHtml(p.displayName)} (${p.provider} / ${escapeHtml(p.model)}) — argued: ${escapeHtml(p.stance)} — total ${totals[p.id] ?? 0}`
    )
    .join('<br/>')}</div>
${
  verdict
    ? `<div class="verdict"><strong>Verdict (${verdict.source === 'ai' ? 'AI judge' : 'human judge'}):</strong> ${escapeHtml(winner)}${verdict.reasoning ? `<br/>${escapeHtml(verdict.reasoning)}` : ''}</div>`
    : ''
}
${turnsHtml}
<script>window.onload = () => setTimeout(() => window.print(), 250);</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Pop-up blocked. Allow pop-ups for this site to export as PDF.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

export function debateStats(session: Session) {
  const speeches = speechTurns(session.turns);
  return session.config.participants.map((p) => {
    const own = speeches.filter((t) => t.participantId === p.id);
    const judged = own.filter((t) => t.judge);
    const wordCount = own.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
    const fallacyCount = judged.reduce((n, t) => n + (t.judge?.fallacies.length ?? 0), 0);
    const avgScore = judged.length
      ? Math.round(judged.reduce((n, t) => n + turnTotal(t) - t.userPoints, 0) / judged.length)
      : 0;
    return {
      participant: p,
      turnCount: own.length,
      wordCount,
      avgWords: own.length ? Math.round(wordCount / own.length) : 0,
      fallacyCount,
      avgScore,
      userPoints: own.reduce((n, t) => n + t.userPoints, 0),
    };
  });
}
