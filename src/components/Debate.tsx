import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSchedule,
  Participant,
  participantTotals,
  PHASE_LABELS,
  Session,
  speechTurns,
  Turn,
  turnTotal,
} from '../types';
import { colorClasses, providerBadge } from '../lib/ui';
import ArgumentGraph from './ArgumentGraph';
import {
  AlertTriangle, Award, ChevronRight, Flag, Gavel, GitBranch, Loader2,
  MessageSquarePlus, Minus, Pause, Play, Plus, RotateCcw, ScrollText, Star,
} from 'lucide-react';

interface DebateProps {
  session: Session;
  streaming: { participantId: string; text: string } | null;
  isGenerating: boolean;
  autoPlay: boolean;
  turnError: string | null;
  judgeBusy: boolean;
  onNextTurn: () => void;
  onRetryTurn: () => void;
  onToggleAuto: () => void;
  onModeratorQuestion: (text: string) => void;
  onAwardPoints: (turnId: string, delta: number) => void;
  onToggleHighlight: (turnId: string) => void;
  onEndDebate: (winnerId: string | 'tie' | 'ai-verdict') => void;
  verdictBusy: boolean;
}

export default function Debate({
  session, streaming, isGenerating, autoPlay, turnError, judgeBusy,
  onNextTurn, onRetryTurn, onToggleAuto, onModeratorQuestion,
  onAwardPoints, onToggleHighlight, onEndDebate, verdictBusy,
}: DebateProps) {
  const { config, turns } = session;
  const participants = config.participants;
  const schedule = useMemo(() => buildSchedule(config), [config]);
  const spoken = speechTurns(turns).length;
  const nextSlot = schedule[spoken];
  const nextSpeaker = nextSlot
    ? participants.find((p) => p.id === nextSlot.participantId)
    : undefined;
  const totals = participantTotals(session);

  const [view, setView] = useState<'transcript' | 'graph'>('transcript');
  const [question, setQuestion] = useState('');
  const [endModalOpen, setEndModalOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, streaming?.text]);

  const byId = (id?: string) => participants.find((p) => p.id === id);

  const askQuestion = () => {
    const q = question.trim();
    if (!q) return;
    onModeratorQuestion(q);
    setQuestion('');
  };

  const phaseProgress = useMemo(() => {
    const phases = ['opening', 'rebuttal', ...(config.crossfire ? ['crossfire'] : []), 'closing'] as const;
    const currentPhase = nextSlot?.phase ?? 'closing';
    return phases.map((ph) => ({
      phase: ph,
      label: PHASE_LABELS[ph],
      state:
        phases.indexOf(currentPhase as any) > phases.indexOf(ph as any)
          ? 'done'
          : currentPhase === ph && nextSlot
            ? 'active'
            : nextSlot
              ? 'pending'
              : 'done',
    }));
  }, [nextSlot, config.crossfire]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-5 w-full grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
      {/* ── Left rail: scoreboard ─────────────────────────────────────── */}
      <aside className="space-y-3 lg:sticky lg:top-20 self-start">
        <div className="glass-dark rounded-2xl p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">Scoreboard</p>
          <div className="space-y-3">
            {participants.map((p) => {
              const c = colorClasses[p.color];
              const isNext = nextSpeaker?.id === p.id;
              const isStreaming = streaming?.participantId === p.id;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-3 transition ${c.border} ${isStreaming ? c.soft : 'bg-slate-950/40'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-display font-semibold truncate ${c.text}`}>{p.displayName}</p>
                      <span className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider ${providerBadge[p.provider]}`}>
                        {p.provider}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl font-display font-bold text-slate-100 tabular-nums">{totals[p.id] ?? 0}</p>
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider">points</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400 leading-snug line-clamp-2">{p.stance}</p>
                  {(isStreaming || isNext) && (
                    <p className={`mt-2 text-[10px] font-mono uppercase tracking-widest ${isStreaming ? c.text : 'text-slate-500'}`}>
                      {isStreaming ? '● speaking now' : '○ up next'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-dark rounded-2xl p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">Format</p>
          <div className="space-y-1.5">
            {phaseProgress.map((ph) => (
              <div key={ph.phase} className="flex items-center gap-2 text-[11px]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    ph.state === 'done' ? 'bg-emerald-400' : ph.state === 'active' ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'
                  }`}
                />
                <span className={ph.state === 'active' ? 'text-slate-200' : 'text-slate-500'}>{ph.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500 tabular-nums">
            Speech {Math.min(spoken + 1, schedule.length)} of {schedule.length}
          </p>
        </div>
      </aside>

      {/* ── Main stage ────────────────────────────────────────────────── */}
      <div className="min-w-0 flex flex-col">
        {/* View tabs */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1 p-1 rounded-xl glass-dark">
            <button
              onClick={() => setView('transcript')}
              className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition ${
                view === 'transcript' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ScrollText className="w-3.5 h-3.5" /> Transcript
            </button>
            <button
              onClick={() => setView('graph')}
              className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition ${
                view === 'graph' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" /> Argument map
            </button>
          </div>
          <button
            onClick={() => setEndModalOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs hover:bg-rose-500/20 transition flex items-center gap-1.5"
          >
            <Flag className="w-3.5 h-3.5" /> End debate
          </button>
        </div>

        {view === 'graph' ? (
          <div className="glass-dark rounded-2xl h-[60vh]">
            <ArgumentGraph session={session} />
          </div>
        ) : (
          <div ref={scrollRef} className="glass-dark rounded-2xl p-4 md:p-5 h-[60vh] overflow-y-auto custom-scrollbar space-y-4">
            {turns.length === 0 && !streaming && (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <p className="text-slate-300 font-display">The floor is open.</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  {nextSpeaker
                    ? `${nextSpeaker.displayName} delivers the first opening statement. Press Next speech, or turn on auto-play to let the debate run.`
                    : 'All speeches are complete.'}
                </p>
              </div>
            )}

            {turns.map((t) =>
              t.kind === 'moderator' ? (
                <ModeratorBubble key={t.id} turn={t} />
              ) : (
                <SpeechCard
                  key={t.id}
                  turn={t}
                  speaker={byId(t.participantId)}
                  onAwardPoints={onAwardPoints}
                  onToggleHighlight={onToggleHighlight}
                />
              )
            )}

            {/* Live stream bubble */}
            {streaming && (
              <LiveBubble speaker={byId(streaming.participantId)} text={streaming.text} />
            )}

            {/* Judge pending indicator */}
            {judgeBusy && !streaming && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5 pl-1">
                <Loader2 className="w-3 h-3 animate-spin" /> AI judge is reviewing the speech…
              </p>
            )}

            {turnError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                <p className="text-xs text-rose-300 font-medium mb-1">The turn failed</p>
                <p className="text-[11px] text-rose-200/80 break-words">{turnError}</p>
                <button
                  onClick={onRetryTurn}
                  className="mt-2.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3 h-3" /> Retry this speech
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Moderator controls ───────────────────────────────────────── */}
        <div className="mt-3 glass-dark rounded-2xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onNextTurn}
              disabled={isGenerating || !nextSlot || Boolean(turnError)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1.5 transition"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {isGenerating
                ? 'Generating…'
                : nextSlot
                  ? `Next speech — ${nextSpeaker?.displayName} (${PHASE_LABELS[nextSlot.phase].toLowerCase()})`
                  : 'All speeches complete'}
            </button>
            <button
              onClick={onToggleAuto}
              disabled={!nextSlot}
              className={`px-3 py-2 rounded-xl border text-xs flex items-center gap-1.5 transition disabled:opacity-40 ${
                autoPlay
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 text-slate-300 hover:border-slate-600'
              }`}
            >
              {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {autoPlay ? 'Auto-play on' : 'Auto-play'}
            </button>
            {!nextSlot && (
              <button
                onClick={() => setEndModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5"
              >
                <Gavel className="w-3.5 h-3.5" /> Deliver the verdict
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
              placeholder="Ask the debaters a question — the next speaker must address it…"
              className="flex-1 px-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
            />
            <button
              onClick={askQuestion}
              disabled={!question.trim()}
              className="px-3 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs hover:border-indigo-500/50 hover:text-indigo-300 disabled:opacity-40 flex items-center gap-1.5 transition"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" /> Ask
            </button>
          </div>
        </div>
      </div>

      {/* ── End-debate modal ────────────────────────────────────────────── */}
      {endModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setEndModalOpen(false)}>
          <div className="glass-premium rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display font-semibold text-slate-100 flex items-center gap-2 mb-1">
              <Gavel className="w-4 h-4 text-indigo-400" /> Call the debate
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Declare the winner yourself, or let the AI judge weigh the full transcript and decide.
            </p>
            <div className="space-y-2">
              {participants.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setEndModalOpen(false); onEndDebate(p.id); }}
                  className={`w-full px-4 py-2.5 rounded-xl border text-left text-sm transition hover:bg-white/5 ${colorClasses[p.color].border} ${colorClasses[p.color].text}`}
                >
                  {p.displayName} wins
                </button>
              ))}
              <button
                onClick={() => { setEndModalOpen(false); onEndDebate('tie'); }}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-left text-sm hover:bg-white/5 transition"
              >
                Declare a tie
              </button>
              {config.judge.enabled && (
                <button
                  onClick={() => { setEndModalOpen(false); onEndDebate('ai-verdict'); }}
                  disabled={verdictBusy || speechTurns(turns).length === 0}
                  className="w-full px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-left text-sm flex items-center gap-2 transition"
                >
                  {verdictBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Let the AI judge decide
                </button>
              )}
            </div>
            <button onClick={() => setEndModalOpen(false)} className="mt-3 w-full py-2 text-xs text-slate-500 hover:text-slate-300">
              Keep debating
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface ModeratorBubbleProps { turn: Turn }
const ModeratorBubble: FC<ModeratorBubbleProps> = ({ turn }) => {
  return (
    <div className="border-l-2 border-slate-600 bg-slate-800/30 rounded-r-xl px-4 py-2.5">
      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-0.5">Moderator</p>
      <p className="text-sm text-slate-300">{turn.text}</p>
    </div>
  );
};

interface LiveBubbleProps { speaker?: Participant; text: string }
const LiveBubble: FC<LiveBubbleProps> = ({ speaker, text }) => {
  const c = speaker ? colorClasses[speaker.color] : colorClasses.indigo;
  return (
    <div className={`rounded-2xl border p-4 ${c.border} ${c.soft}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-sm font-display font-semibold ${c.text}`}>{speaker?.displayName ?? '…'}</span>
        <span className="flex items-center gap-1 text-[10px] text-slate-400 font-mono uppercase tracking-widest">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${c.bg}`} /> live
        </span>
      </div>
      <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
        {text}
        <span className="inline-block w-2 h-4 ml-0.5 bg-slate-400 animate-pulse align-text-bottom" />
      </p>
    </div>
  );
};

interface SpeechCardProps {
  turn: Turn;
  speaker?: Participant;
  onAwardPoints: (turnId: string, delta: number) => void;
  onToggleHighlight: (turnId: string) => void;
}
const SpeechCard: FC<SpeechCardProps> = ({
  turn, speaker, onAwardPoints, onToggleHighlight,
}) => {
  const c = speaker ? colorClasses[speaker.color] : colorClasses.indigo;
  const [expanded, setExpanded] = useState(false);
  const judge = turn.judge;

  return (
    <div className={`rounded-2xl border p-4 bg-slate-950/40 transition ${turn.highlighted ? 'border-amber-400/60 shadow-[0_0_18px_rgba(251,191,36,0.12)]' : c.border}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm font-display font-semibold truncate ${c.text}`}>{speaker?.displayName}</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 shrink-0">
            {PHASE_LABELS[turn.phase]}{turn.round ? ` · R${turn.round}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggleHighlight(turn.id)}
            className={`p-1.5 rounded-lg transition ${turn.highlighted ? 'text-amber-300 bg-amber-500/10' : 'text-slate-600 hover:text-amber-300 hover:bg-white/5'}`}
            title={turn.highlighted ? 'Remove highlight' : 'Highlight as a strong argument'}
          >
            <Star className="w-3.5 h-3.5" fill={turn.highlighted ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => onAwardPoints(turn.id, -5)}
            className="p-1.5 rounded-lg text-slate-600 hover:text-rose-300 hover:bg-white/5 transition"
            title="Penalize (−5 points)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onAwardPoints(turn.id, 5)}
            className="p-1.5 rounded-lg text-slate-600 hover:text-emerald-300 hover:bg-white/5 transition"
            title="Award (+5 points)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{turn.text}</p>

      {/* Judge strip */}
      <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {turn.judgePending && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> awaiting judge review
          </span>
        )}
        {turn.judgeError && (
          <span className="text-[10px] text-amber-400/90 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> judge review failed: {turn.judgeError}
          </span>
        )}
        {judge && (
          <>
            <span className="text-[11px] text-slate-300 font-medium tabular-nums flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-indigo-400" /> {turnTotal(turn)} pts
            </span>
            {(['logic', 'evidence', 'relevance', 'persuasiveness', 'consistency'] as const).map((k) => (
              <span key={k} className="text-[10px] text-slate-500 tabular-nums">
                {k.slice(0, 5)} <span className="text-slate-300">{judge.scores[k]}</span>
              </span>
            ))}
            {turn.userPoints !== 0 && (
              <span className={`text-[10px] tabular-nums ${turn.userPoints > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                you: {turn.userPoints > 0 ? '+' : ''}{turn.userPoints}
              </span>
            )}
            {judge.fallacies.map((f, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {f.type}
              </span>
            ))}
            <button onClick={() => setExpanded((v) => !v)} className="text-[10px] text-slate-500 hover:text-indigo-300 ml-auto">
              {expanded ? 'Hide review' : 'Judge review'}
            </button>
          </>
        )}
        {!judge && !turn.judgePending && !turn.judgeError && turn.userPoints !== 0 && (
          <span className={`text-[10px] tabular-nums ${turn.userPoints > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            your points: {turn.userPoints > 0 ? '+' : ''}{turn.userPoints}
          </span>
        )}
      </div>

      {expanded && judge && (
        <div className="mt-2.5 rounded-xl bg-slate-900/60 border border-white/5 p-3 space-y-2">
          <p className="text-[11px] text-slate-400"><span className="text-slate-500">Core claim:</span> {judge.claim}</p>
          {judge.commentary && <p className="text-[11px] text-slate-300 italic">"{judge.commentary}"</p>}
          {judge.fallacies.map((f, i) => (
            <div key={i} className="text-[11px] text-amber-200/90 border-l-2 border-amber-500/50 pl-2">
              <span className="font-medium">{f.type}:</span> "{f.quote}" — {f.explanation}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
