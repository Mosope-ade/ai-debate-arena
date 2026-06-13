import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildSchedule,
  DebateConfig,
  Session,
  speechTurns,
  Turn,
} from './types';
import Setup from './components/Setup';
import Debate from './components/Debate';
import Analytics from './components/Analytics';
import KeysModal from './components/KeysModal';
import {
  fetchHealth,
  HealthInfo,
  requestJudgeReview,
  requestVerdict,
  streamTurn,
} from './lib/api';
import { getKeys, loadSession, saveSession } from './lib/storage';
import { KeyRound, Swords } from 'lucide-react';

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++idCounter}`;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [streaming, setStreaming] = useState<{ participantId: string; text: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  // Refs so async flows always read current state (and StrictMode double-effects stay safe)
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const generatingRef = useRef(false);
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const keysConfigured =
    Object.keys(getKeys()).length > 0 ||
    Boolean(health && Object.values(health.serverKeys).some(Boolean));

  // ── Session mutation helpers ─────────────────────────────────────────────

  const patchSession = useCallback((updater: (s: Session) => Session) => {
    setSession((s) => (s ? updater(s) : s));
  }, []);

  const patchTurn = useCallback(
    (turnId: string, patch: Partial<Turn>) => {
      patchSession((s) => ({
        ...s,
        turns: s.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)),
      }));
    },
    [patchSession]
  );

  // ── Start / load / reset ─────────────────────────────────────────────────

  const handleStart = (config: DebateConfig) => {
    setSession({
      id: newId('debate'),
      createdAt: Date.now(),
      config,
      turns: [],
      status: 'live',
    });
    setAutoPlay(false);
    setTurnError(null);
    setStreaming(null);
  };

  const handleLoadSession = (id: string) => {
    const loaded = loadSession(id);
    if (loaded) setSession(loaded);
  };

  const handleReset = () => {
    setSession(null);
    setStreaming(null);
    setAutoPlay(false);
    setTurnError(null);
  };

  // ── Judge review (async, after each speech completes) ───────────────────

  const runJudge = useCallback(
    async (turnId: string, speakerId: string, speech: string) => {
      const s = sessionRef.current;
      if (!s || !s.config.judge.enabled) return;
      const speaker = s.config.participants.find((p) => p.id === speakerId);
      if (!speaker) return;

      setJudgeBusy(true);
      try {
        const review = await requestJudgeReview({
          judgeProvider: s.config.judge.provider,
          judgeModel: s.config.judge.model,
          topic: s.config.topic,
          speaker,
          speech,
          participants: s.config.participants,
          // Context = everything before this speech
          turns: s.turns.filter((t) => t.id !== turnId),
        });
        patchTurn(turnId, { judge: review, judgePending: false, judgeError: undefined });
      } catch (err: any) {
        patchTurn(turnId, {
          judgePending: false,
          judgeError: err?.message || 'Judge call failed.',
        });
      } finally {
        setJudgeBusy(false);
      }
    },
    [patchTurn]
  );

  // ── Generate the next speech ─────────────────────────────────────────────

  const nextTurn = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.status !== 'live' || generatingRef.current) return;

    const schedule = buildSchedule(s.config);
    const slot = schedule[speechTurns(s.turns).length];
    if (!slot) {
      setAutoPlay(false);
      return;
    }
    const speaker = s.config.participants.find((p) => p.id === slot.participantId);
    if (!speaker) return;

    generatingRef.current = true;
    setIsGenerating(true);
    setTurnError(null);
    setStreaming({ participantId: speaker.id, text: '' });
    const startedAt = Date.now();

    try {
      const text = await streamTurn({
        topic: s.config.topic,
        speaker,
        participants: s.config.participants,
        phase: slot.phase,
        turns: s.turns,
        onDelta: (delta) =>
          setStreaming((prev) =>
            prev && prev.participantId === speaker.id
              ? { ...prev, text: prev.text + delta }
              : prev
          ),
      });

      const turn: Turn = {
        id: newId('turn'),
        kind: 'speech',
        participantId: speaker.id,
        phase: slot.phase,
        round: slot.round,
        text,
        judgePending: sessionRef.current?.config.judge.enabled ?? false,
        userPoints: 0,
        highlighted: false,
        startedAt,
        durationMs: Date.now() - startedAt,
      };
      patchSession((cur) => ({ ...cur, turns: [...cur.turns, turn] }));
      setStreaming(null);

      // Judge runs in the background; the debate can continue meanwhile.
      void runJudge(turn.id, speaker.id, text);
    } catch (err: any) {
      setStreaming(null);
      setTurnError(err?.message || 'The model call failed.');
      setAutoPlay(false);
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  }, [patchSession, runJudge]);

  // ── Auto-play loop ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoPlay || !session || session.status !== 'live') return;
    if (isGenerating || turnError) return;
    const schedule = buildSchedule(session.config);
    if (speechTurns(session.turns).length >= schedule.length) {
      setAutoPlay(false);
      return;
    }
    const timer = setTimeout(() => {
      if (autoPlayRef.current && !generatingRef.current) void nextTurn();
    }, 1500);
    return () => clearTimeout(timer);
  }, [autoPlay, session, isGenerating, turnError, nextTurn]);

  // ── Moderator + human judging actions ────────────────────────────────────

  const handleModeratorQuestion = (text: string) => {
    const s = sessionRef.current;
    if (!s) return;
    const schedule = buildSchedule(s.config);
    const slot = schedule[speechTurns(s.turns).length];
    const turn: Turn = {
      id: newId('mod'),
      kind: 'moderator',
      phase: slot?.phase ?? 'closing',
      round: slot?.round ?? 0,
      text,
      userPoints: 0,
      highlighted: false,
      startedAt: Date.now(),
    };
    patchSession((cur) => ({ ...cur, turns: [...cur.turns, turn] }));
  };

  const handleAwardPoints = (turnId: string, delta: number) => {
    const t = sessionRef.current?.turns.find((x) => x.id === turnId);
    if (t) patchTurn(turnId, { userPoints: t.userPoints + delta });
  };

  const handleToggleHighlight = (turnId: string) => {
    const t = sessionRef.current?.turns.find((x) => x.id === turnId);
    if (t) patchTurn(turnId, { highlighted: !t.highlighted });
  };

  // ── Ending the debate ────────────────────────────────────────────────────

  const completeSession = (winnerId: string | 'tie', reasoning: string, source: 'human' | 'ai') => {
    setAutoPlay(false);
    patchSession((s) => {
      const done: Session = {
        ...s,
        status: 'completed',
        completedAt: Date.now(),
        verdict: { winnerId, reasoning, source },
      };
      saveSession(done);
      return done;
    });
  };

  const handleEndDebate = async (choice: string | 'tie' | 'ai-verdict') => {
    const s = sessionRef.current;
    if (!s) return;

    if (choice !== 'ai-verdict') {
      completeSession(choice, '', 'human');
      return;
    }

    setVerdictBusy(true);
    try {
      const { winnerId, reasoning } = await requestVerdict({
        judgeProvider: s.config.judge.provider,
        judgeModel: s.config.judge.model,
        topic: s.config.topic,
        participants: s.config.participants,
        turns: s.turns,
      });
      completeSession(winnerId, reasoning, 'ai');
    } catch (err: any) {
      setTurnError(`Verdict failed: ${err?.message || 'unknown error'}. You can still declare a winner manually.`);
    } finally {
      setVerdictBusy(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#020617] cyber-grid text-slate-200 font-sans flex flex-col">
      <header className="h-14 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md flex items-center justify-between px-4 md:px-6 sticky top-0 z-40">
        <button onClick={handleReset} className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Swords className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold tracking-tight text-slate-100 group-hover:text-indigo-200 transition">
            AI Debate Arena
          </span>
        </button>

        <div className="flex-1 mx-4 text-center hidden md:block min-w-0">
          {session && (
            <p className="text-xs text-slate-400 truncate">"{session.config.topic}"</p>
          )}
        </div>

        <button
          onClick={() => setKeysOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs hover:border-indigo-500/50 hover:text-indigo-300 transition"
        >
          <KeyRound className="w-3.5 h-3.5" /> API keys
        </button>
      </header>

      <main className="flex-1 flex flex-col py-4">
        {!session && (
          <Setup
            onStart={handleStart}
            onOpenKeys={() => setKeysOpen(true)}
            onLoadSession={handleLoadSession}
            keysConfigured={keysConfigured}
          />
        )}

        {session?.status === 'live' && (
          <Debate
            session={session}
            streaming={streaming}
            isGenerating={isGenerating}
            autoPlay={autoPlay}
            turnError={turnError}
            judgeBusy={judgeBusy}
            onNextTurn={() => void nextTurn()}
            onRetryTurn={() => { setTurnError(null); void nextTurn(); }}
            onToggleAuto={() => setAutoPlay((v) => !v)}
            onModeratorQuestion={handleModeratorQuestion}
            onAwardPoints={handleAwardPoints}
            onToggleHighlight={handleToggleHighlight}
            onEndDebate={(c) => void handleEndDebate(c)}
            verdictBusy={verdictBusy}
          />
        )}

        {session?.status === 'completed' && (
          <Analytics session={session} onReset={handleReset} />
        )}
      </main>

      <KeysModal
        open={keysOpen}
        onClose={() => {
          setKeysOpen(false);
          fetchHealth().then(setHealth).catch(() => {});
        }}
        serverKeys={health?.serverKeys ?? {}}
      />
    </div>
  );
}
