import { useEffect, useMemo, useState } from 'react';
import {
  DebateConfig,
  JudgeConfig,
  Participant,
  PROVIDERS,
  ProviderId,
  providerInfo,
} from '../types';
import { fetchModels } from '../lib/api';
import { deleteSession, listSessions, SessionSummary } from '../lib/storage';
import { colorClasses, PARTICIPANT_COLORS, providerBadge } from '../lib/ui';
import {
  Gavel, History, KeyRound, Loader2, Play, Plus, RefreshCw, Swords, Trash2, X,
} from 'lucide-react';

interface SetupProps {
  onStart: (config: DebateConfig) => void;
  onOpenKeys: () => void;
  onLoadSession: (id: string) => void;
  keysConfigured: boolean;
}

const TOPIC_PRESETS = [
  'Should advanced AI development be paused until alignment is solved?',
  'Is remote work better than office work for software teams?',
  'Should social media platforms be liable for user-generated content?',
  'Is nuclear energy the most realistic path to decarbonization?',
];

interface ParticipantDraft {
  id: string;
  provider: ProviderId;
  model: string;
  displayName: string;
  stance: string;
}

let draftCounter = 0;
const newDraft = (provider: ProviderId, model: string, stance: string): ParticipantDraft => ({
  id: `p${++draftCounter}-${Date.now().toString(36)}`,
  provider,
  model,
  displayName: '',
  stance,
});

export default function Setup({ onStart, onOpenKeys, onLoadSession, keysConfigured }: SetupProps) {
  const [topic, setTopic] = useState('');
  const [participants, setParticipants] = useState<ParticipantDraft[]>([
    newDraft('anthropic', providerInfo('anthropic').defaultModels[0], 'For the motion'),
    newDraft('openai', providerInfo('openai').defaultModels[0], 'Against the motion'),
  ]);
  const [judge, setJudge] = useState<JudgeConfig>({
    enabled: true,
    provider: 'google',
    model: providerInfo('google').defaultModels[0],
  });
  const [rebuttalRounds, setRebuttalRounds] = useState(2);
  const [crossfire, setCrossfire] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Live model catalogs, fetched per provider with the configured key.
  const [catalogs, setCatalogs] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [catalogState, setCatalogState] = useState<Partial<Record<ProviderId, 'loading' | 'error' | 'ok'>>>({});

  const loadCatalog = async (provider: ProviderId, force = false) => {
    if (!force && (catalogs[provider] || catalogState[provider] === 'loading')) return;
    setCatalogState((s) => ({ ...s, [provider]: 'loading' }));
    try {
      const models = await fetchModels(provider);
      setCatalogs((c) => ({ ...c, [provider]: models }));
      setCatalogState((s) => ({ ...s, [provider]: 'ok' }));
    } catch {
      setCatalogState((s) => ({ ...s, [provider]: 'error' }));
    }
  };

  useEffect(() => {
    const used = new Set<ProviderId>([...participants.map((p) => p.provider), judge.provider]);
    used.forEach((p) => loadCatalog(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants.map((p) => p.provider).join(','), judge.provider]);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  useEffect(() => setSessions(listSessions()), []);

  const modelOptions = (provider: ProviderId, current: string): string[] => {
    const live = catalogs[provider];
    const presets = providerInfo(provider).defaultModels;
    const merged = live?.length ? live : presets;
    return merged.includes(current) || !current ? merged : [current, ...merged];
  };

  const updateParticipant = (id: string, patch: Partial<ParticipantDraft>) => {
    setParticipants((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        if (patch.provider && patch.provider !== p.provider) {
          next.model = providerInfo(patch.provider).defaultModels[0];
        }
        return next;
      })
    );
  };

  const addParticipant = () => {
    if (participants.length >= 4) return;
    setParticipants((list) => [...list, newDraft('openrouter', providerInfo('openrouter').defaultModels[0], '')]);
  };

  const removeParticipant = (id: string) => {
    if (participants.length <= 2) return;
    setParticipants((list) => list.filter((p) => p.id !== id));
  };

  const totalTurns = useMemo(() => {
    const n = participants.length;
    return n * (2 + rebuttalRounds + (crossfire ? 1 : 0));
  }, [participants.length, rebuttalRounds, crossfire]);

  const handleStart = () => {
    setFormError(null);
    if (!topic.trim()) return setFormError('Enter a debate topic.');
    for (const p of participants) {
      if (!p.model.trim()) return setFormError('Every participant needs a model.');
      if (!p.stance.trim()) return setFormError('Every participant needs a position to argue.');
    }
    const built: Participant[] = participants.map((p, i) => ({
      id: p.id,
      provider: p.provider,
      model: p.model.trim(),
      displayName: p.displayName.trim() || p.model.trim(),
      stance: p.stance.trim(),
      color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
    }));
    onStart({
      topic: topic.trim(),
      participants: built,
      judge: { ...judge, model: judge.model.trim() },
      rebuttalRounds,
      crossfire,
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 w-full">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-950/40 text-indigo-300 mb-4">
          <Swords className="w-4 h-4" />
          <span className="text-[10px] font-mono tracking-widest uppercase">Multi-model debate platform</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight bg-gradient-to-r from-indigo-200 via-slate-100 to-rose-200 bg-clip-text text-transparent">
          AI DEBATE ARENA
        </h1>
        <p className="text-slate-400 mt-3 text-sm max-w-xl mx-auto">
          Pick a topic, choose which AI models take each side, and judge the clash. Every
          argument comes live from the actual model — nothing is simulated.
        </p>
        {!keysConfigured && (
          <button
            onClick={onOpenKeys}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs hover:bg-amber-500/20 transition"
          >
            <KeyRound className="w-4 h-4" /> Add your API keys to begin
          </button>
        )}
      </div>

      <div className="glass-premium p-6 md:p-8 rounded-3xl space-y-7">
        {/* Topic */}
        <section className="space-y-2">
          <label htmlFor="topic" className="block text-xs font-mono tracking-wider text-slate-400 uppercase">
            Debate topic
          </label>
          <input
            id="topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter any question or motion worth arguing about…"
            className="w-full px-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 text-sm"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {TOPIC_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTopic(t)}
                className="px-3 py-1.5 rounded-lg border border-white/5 bg-white/2 hover:bg-slate-800/80 hover:text-indigo-300 text-[11px] text-slate-400 text-left transition"
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* Participants */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-mono tracking-wider text-slate-400 uppercase">
              Debaters ({participants.length})
            </label>
            <button
              type="button"
              onClick={addParticipant}
              disabled={participants.length >= 4}
              className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" /> Add debater (max 4)
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {participants.map((p, idx) => {
              const color = colorClasses[PARTICIPANT_COLORS[idx % PARTICIPANT_COLORS.length]];
              const state = catalogState[p.provider];
              return (
                <div key={p.id} className={`rounded-2xl border bg-slate-950/50 p-4 space-y-2.5 ${color.border}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-mono uppercase tracking-widest ${color.text}`}>
                      Debater {idx + 1}
                    </span>
                    {participants.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeParticipant(p.id)}
                        className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-rose-400"
                        aria-label={`Remove debater ${idx + 1}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block text-[10px] text-slate-500 mb-1">Provider</span>
                      <select
                        value={p.provider}
                        onChange={(e) => updateParticipant(p.id, { provider: e.target.value as ProviderId })}
                        className="w-full px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50"
                      >
                        {PROVIDERS.map((pr) => (
                          <option key={pr.id} value={pr.id}>{pr.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
                        Model
                        {state === 'loading' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        {state === 'error' && (
                          <button
                            type="button"
                            onClick={() => loadCatalog(p.provider, true)}
                            className="text-amber-400 hover:text-amber-300 flex items-center gap-0.5"
                            title="Live model list unavailable (check key). Using presets — click to retry."
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> presets
                          </button>
                        )}
                      </span>
                      <select
                        value={p.model}
                        onChange={(e) => updateParticipant(p.id, { model: e.target.value })}
                        className="w-full px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500/50"
                      >
                        {modelOptions(p.provider, p.model).map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-500 mb-1">Position to argue</span>
                    <input
                      type="text"
                      value={p.stance}
                      onChange={(e) => updateParticipant(p.id, { stance: e.target.value })}
                      placeholder={idx === 0 ? 'e.g. For the motion' : 'e.g. Against the motion'}
                      className="w-full px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-500 mb-1">Display name (optional)</span>
                    <input
                      type="text"
                      value={p.displayName}
                      onChange={(e) => updateParticipant(p.id, { displayName: e.target.value })}
                      placeholder={p.model || 'Defaults to the model name'}
                      className="w-full px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Judge + format */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                <Gavel className="w-3.5 h-3.5" /> AI judge
              </span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={judge.enabled}
                  onChange={(e) => setJudge((j) => ({ ...j, enabled: e.target.checked }))}
                  className="accent-indigo-500"
                />
                <span className="text-[11px] text-slate-400">{judge.enabled ? 'On' : 'Off'}</span>
              </label>
            </div>
            <p className="text-[11px] text-slate-500">
              A separate model scores each speech (logic, evidence, relevance, persuasion,
              consistency), flags logical fallacies, and can call the final verdict. You can
              always award points yourself either way.
            </p>
            {judge.enabled && (
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={judge.provider}
                  onChange={(e) => {
                    const provider = e.target.value as ProviderId;
                    setJudge((j) => ({ ...j, provider, model: providerInfo(provider).defaultModels[0] }));
                  }}
                  className="px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50"
                >
                  {PROVIDERS.map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.label}</option>
                  ))}
                </select>
                <select
                  value={judge.model}
                  onChange={(e) => setJudge((j) => ({ ...j, model: e.target.value }))}
                  className="px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500/50"
                >
                  {modelOptions(judge.provider, judge.model).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
            <span className="text-xs font-mono tracking-wider text-slate-400 uppercase">Format</span>
            <div>
              <span className="block text-[11px] text-slate-500 mb-1.5">Rebuttal rounds</span>
              <div className="flex gap-2">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRebuttalRounds(n)}
                    className={`flex-1 py-2 rounded-lg border text-xs transition ${
                      rebuttalRounds === n
                        ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-200'
                        : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={crossfire}
                onChange={(e) => setCrossfire(e.target.checked)}
                className="accent-indigo-500"
              />
              <span className="text-[11px] text-slate-400">Include cross-examination round</span>
            </label>
            <p className="text-[11px] text-slate-500">
              Openings → {rebuttalRounds} rebuttal round{rebuttalRounds > 1 ? 's' : ''}
              {crossfire ? ' → cross-examination' : ''} → closings · {totalTurns} speeches total.
              You can interject questions or end the debate at any point.
            </p>
          </div>
        </section>

        {formError && (
          <p className="text-xs text-rose-400" role="alert">{formError}</p>
        )}

        <button
          type="button"
          onClick={handleStart}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-display font-semibold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-indigo-500/20"
        >
          <Play className="w-4 h-4" /> Start debate
        </button>
      </div>

      {/* Saved sessions */}
      {sessions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-mono tracking-wider text-slate-400 uppercase mb-3 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> Saved debates
          </h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="glass-dark rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:border-indigo-500/30 transition cursor-pointer"
                onClick={() => onLoadSession(s.id)}
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 truncate">{s.topic}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {new Date(s.createdAt).toLocaleString()} · {s.participantNames.join(' vs ')}
                    {s.winnerName ? ` · Winner: ${s.winnerName}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s.id);
                    setSessions(listSessions());
                  }}
                  className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 shrink-0"
                  aria-label="Delete saved debate"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
