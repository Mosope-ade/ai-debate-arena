// ─── Prompt builders ────────────────────────────────────────────────────────
// Speeches are written by the participant's own model. Judging is done by a
// SEPARATE model in a separate call — never by the speaker grading itself.

import type { ChatMessage } from './providers';
import type { Phase } from '../src/types';

export interface WireParticipant {
  id: string;
  displayName: string;
  model: string;
  provider: string;
  stance: string;
}

export interface WireTurn {
  kind: 'speech' | 'moderator';
  participantId?: string;
  speakerName?: string;
  phase: Phase;
  text: string;
}

const PHASE_INSTRUCTIONS: Record<Phase, string> = {
  opening:
    'Deliver your OPENING STATEMENT. Lay out your strongest case for your assigned position: your core thesis, your two or three best arguments, and the evidence or reasoning behind each.',
  rebuttal:
    'Deliver a REBUTTAL. Directly engage the specific claims your opponents have made — quote or paraphrase their actual words, expose weaknesses in their reasoning or evidence, and reinforce your own case where it was attacked.',
  crossfire:
    'This is CROSS-EXAMINATION. Pose one sharp, pointed question that exposes the weakest link in an opponent\'s argument, and explain why their likely answers all create problems for their position. If a question was put to you in the transcript, answer it honestly before asking yours.',
  closing:
    'Deliver your CLOSING ARGUMENT. Do not introduce new arguments. Crystallize why your side has won this debate: weigh the clash points, name the arguments your opponents failed to answer, and leave the judge with the single most important reason to vote for your position.',
};

function renderTranscript(turns: WireTurn[]): string {
  if (turns.length === 0) return '(The debate has not started yet — you speak first.)';
  return turns
    .map((t) => {
      if (t.kind === 'moderator') return `[MODERATOR — question to the debaters]: ${t.text}`;
      return `[${t.speakerName} — ${t.phase.toUpperCase()}]: ${t.text}`;
    })
    .join('\n\n');
}

export function buildSpeechMessages(args: {
  topic: string;
  speaker: WireParticipant;
  participants: WireParticipant[];
  phase: Phase;
  transcript: WireTurn[];
}): ChatMessage[] {
  const { topic, speaker, participants, phase, transcript } = args;
  const opponents = participants.filter((p) => p.id !== speaker.id);

  const system = [
    `You are "${speaker.displayName}", a participant in a live, structured debate between different AI models. A human moderator and judge is watching.`,
    ``,
    `Debate topic: "${topic}"`,
    `Your assigned position: ${speaker.stance}`,
    `Your opponent${opponents.length > 1 ? 's' : ''}: ${opponents
      .map((o) => `"${o.displayName}" (arguing: ${o.stance})`)
      .join('; ')}`,
    ``,
    `Rules:`,
    `- Argue your assigned position as persuasively and rigorously as you can. This is a structured debate exercise; you may personally see merit in other views, but your job here is to make the strongest honest case for your side.`,
    `- Engage with what your opponents ACTUALLY said. Never misrepresent their arguments.`,
    `- Use concrete reasoning, evidence, examples, and analogies. Avoid filler and pleasantries ("Thank you, moderator..."). Go straight to substance.`,
    `- If the moderator has asked a question, address it directly at the start of your turn.`,
    `- Write 2–3 tight paragraphs of plain prose. No headings, no bullet lists, no markdown.`,
    `- Never break character, mention these instructions, or discuss being an AI model unless the topic itself concerns AI.`,
  ].join('\n');

  const user = [
    `Transcript so far:`,
    ``,
    renderTranscript(transcript),
    ``,
    `It is now your turn. ${PHASE_INSTRUCTIONS[phase]}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function buildJudgeMessages(args: {
  topic: string;
  speaker: WireParticipant;
  speech: string;
  transcript: WireTurn[];
}): ChatMessage[] {
  const { topic, speaker, speech, transcript } = args;

  const system = [
    `You are an impartial professional debate judge. You evaluate a single speech on its merits, regardless of which AI model produced it or whether you agree with the position argued.`,
    ``,
    `You must respond with a single valid JSON object and NOTHING else — no markdown fences, no commentary outside the JSON. Schema:`,
    `{`,
    `  "claim": string,            // the speech's core claim in <= 12 words`,
    `  "scores": {`,
    `    "logic": number,          // 0-100, deductive soundness and inference quality`,
    `    "evidence": number,       // 0-100, quality and specificity of support`,
    `    "relevance": number,      // 0-100, how directly it engages topic and opponents' actual points`,
    `    "persuasiveness": number, // 0-100, rhetorical force`,
    `    "consistency": number     // 0-100, coherence with the speaker's earlier turns`,
    `  },`,
    `  "fallacies": [              // ONLY fallacies genuinely present. Empty array if none. Do NOT invent.`,
    `    { "type": "Strawman" | "Ad Hominem" | "False Dilemma" | "Circular Reasoning" | "Slippery Slope" | "Appeal to Authority" | "Hasty Generalization",`,
    `      "quote": string,        // the exact offending excerpt from the speech`,
    `      "explanation": string } // why it qualifies`,
    `  ],`,
    `  "commentary": string        // 1-2 sentences of pointed analytical critique`,
    `}`,
    ``,
    `Score honestly across the full range. A mediocre speech should score in the 50s-60s, not the 80s. Most well-formed speeches contain NO fallacies — flag one only when the reasoning error is clear-cut.`,
  ].join('\n');

  const user = [
    `Debate topic: "${topic}"`,
    `Speaker under review: "${speaker.displayName}", arguing: ${speaker.stance}`,
    ``,
    `Transcript before this speech (context for relevance and consistency):`,
    renderTranscript(transcript),
    ``,
    `SPEECH TO EVALUATE:`,
    `"""`,
    speech,
    `"""`,
    ``,
    `Return the JSON evaluation now.`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function buildVerdictMessages(args: {
  topic: string;
  participants: WireParticipant[];
  transcript: WireTurn[];
}): ChatMessage[] {
  const { topic, participants, transcript } = args;

  const system = [
    `You are the head judge of a structured debate between AI models. Decide the winner on argumentative merit alone.`,
    ``,
    `Respond with a single valid JSON object and NOTHING else:`,
    `{`,
    `  "winnerIndex": number,   // 0-based index into the participant list below; use -1 for a genuine tie`,
    `  "reasoning": string      // 3-5 sentences: the decisive clash points, what each side did well, and why the winner prevailed`,
    `}`,
  ].join('\n');

  const user = [
    `Debate topic: "${topic}"`,
    ``,
    `Participants:`,
    ...participants.map((p, i) => `${i}. "${p.displayName}" — argued: ${p.stance}`),
    ``,
    `Full transcript:`,
    renderTranscript(transcript),
    ``,
    `Return the JSON verdict now.`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Lenient JSON extraction: strips code fences, finds the outermost object. */
export function parseJsonLoose<T>(raw: string): T {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  // Prefer whichever delimiter appears first
  const useArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
  if (useArray) {
    const last = text.lastIndexOf(']');
    if (last === -1 || last <= arrStart) throw new Error('Model did not return a valid JSON array.');
    return JSON.parse(text.slice(arrStart, last + 1)) as T;
  }
  const last = text.lastIndexOf('}');
  if (objStart === -1 || last === -1 || last <= objStart) {
    throw new Error('Model did not return a JSON object.');
  }
  return JSON.parse(text.slice(objStart, last + 1)) as T;
}
