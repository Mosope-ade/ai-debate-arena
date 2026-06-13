import { useMemo } from 'react';
import {
  Legend, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  participantTotals, Session, SCORE_CATEGORIES, speechTurns, turnTotal, PHASE_LABELS,
} from '../types';
import { debateStats, exportJson, exportMarkdown, exportPdf } from '../lib/exports';
import { colorClasses, providerBadge } from '../lib/ui';
import ArgumentGraph from './ArgumentGraph';
import {
  AlertTriangle, Download, FileJson, FileText, Printer, RotateCcw, Star, Trophy,
} from 'lucide-react';

interface AnalyticsProps {
  session: Session;
  onReset: () => void;
}

export default function Analytics({ session, onReset }: AnalyticsProps) {
  const { config, turns, verdict } = session;
  const totals = participantTotals(session);
  const stats = useMemo(() => debateStats(session), [session]);
  const speeches = speechTurns(turns);

  const winner =
    verdict && verdict.winnerId !== 'tie'
      ? config.participants.find((p) => p.id === verdict.winnerId)
      : undefined;

  // Cumulative score progression per speech
  const progression = useMemo(() => {
    const running: Record<string, number> = {};
    config.participants.forEach((p) => (running[p.id] = 0));
    return speeches.map((t, i) => {
      if (t.participantId) running[t.participantId] += turnTotal(t);
      const point: Record<string, number | string> = { speech: i + 1 };
      config.participants.forEach((p) => (point[p.displayName] = running[p.id]));
      return point;
    });
  }, [speeches, config.participants]);

  // Average category scores per participant for the radar
  const radarData = useMemo(() => {
    return SCORE_CATEGORIES.map((cat) => {
      const row: Record<string, number | string> = {
        category: cat[0].toUpperCase() + cat.slice(1),
      };
      for (const p of config.participants) {
        const judged = speeches.filter((t) => t.participantId === p.id && t.judge);
        row[p.displayName] = judged.length
          ? Math.round(judged.reduce((n, t) => n + t.judge!.scores[cat], 0) / judged.length)
          : 0;
      }
      return row;
    });
  }, [speeches, config.participants]);

  const allFallacies = useMemo(
    () =>
      speeches.flatMap((t) =>
        (t.judge?.fallacies ?? []).map((f) => ({
          ...f,
          speakerName: config.participants.find((p) => p.id === t.participantId)?.displayName ?? '?',
        }))
      ),
    [speeches, config.participants]
  );

  const bestTurn = useMemo(() => {
    const judged = speeches.filter((t) => t.judge);
    if (!judged.length) return undefined;
    return judged.reduce((a, b) => (turnTotal(b) > turnTotal(a) ? b : a));
  }, [speeches]);

  const highlights = speeches.filter((t) => t.highlighted);

  return (
    <div className="max-w-6xl mx-auto px-4 w-full space-y-5">
      {/* Winner banner */}
      <div className="glass-premium rounded-3xl p-6 md:p-8 text-center relative overflow-hidden">
        <Trophy className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">
          {verdict ? (verdict.source === 'ai' ? 'AI judge verdict' : 'Human judge verdict') : 'Debate complete'}
        </p>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-slate-100">
          {winner ? (
            <span className={colorClasses[winner.color].text}>{winner.displayName} wins</span>
          ) : (
            'Declared a tie'
          )}
        </h1>
        <p className="text-sm text-slate-400 mt-2">"{config.topic}"</p>
        {verdict?.reasoning && (
          <p className="text-sm text-slate-300 mt-4 max-w-2xl mx-auto leading-relaxed">{verdict.reasoning}</p>
        )}

        <div className="flex flex-wrap justify-center gap-3 mt-6">
          {config.participants.map((p) => (
            <div key={p.id} className={`rounded-xl border px-4 py-2.5 ${colorClasses[p.color].border} bg-slate-950/40`}>
              <p className={`text-sm font-display font-semibold ${colorClasses[p.color].text}`}>{p.displayName}</p>
              <span className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase ${providerBadge[p.provider]}`}>
                {p.provider} · {p.model}
              </span>
              <p className="text-2xl font-display font-bold text-slate-100 tabular-nums mt-1">{totals[p.id] ?? 0}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-dark rounded-2xl p-5">
          <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-4">Score progression</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={progression}>
                <XAxis dataKey="speech" stroke="#475569" fontSize={11} label={{ value: 'speech #', position: 'insideBottomRight', fontSize: 10, fill: '#64748b' }} />
                <YAxis stroke="#475569" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {config.participants.map((p) => (
                  <Line
                    key={p.id}
                    type="monotone"
                    dataKey={p.displayName}
                    stroke={colorClasses[p.color].hex}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-dark rounded-2xl p-5">
          <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-4">Average scores by category</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="#1e293b" />
                <PolarAngleAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                {config.participants.map((p) => (
                  <Radar
                    key={p.id}
                    name={p.displayName}
                    dataKey={p.displayName}
                    stroke={colorClasses[p.color].hex}
                    fill={colorClasses[p.color].hex}
                    fillOpacity={0.18}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Participation stats */}
      <div className="glass-dark rounded-2xl p-5">
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-4">Participation</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-white/5">
                <th className="pb-2 pr-4 font-medium">Debater</th>
                <th className="pb-2 pr-4 font-medium">Speeches</th>
                <th className="pb-2 pr-4 font-medium">Words</th>
                <th className="pb-2 pr-4 font-medium">Avg words / speech</th>
                <th className="pb-2 pr-4 font-medium">Avg judge score</th>
                <th className="pb-2 pr-4 font-medium">Your points</th>
                <th className="pb-2 font-medium">Fallacies flagged</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.participant.id} className="border-b border-white/5 last:border-0">
                  <td className={`py-2.5 pr-4 font-medium ${colorClasses[s.participant.color].text}`}>
                    {s.participant.displayName}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-300 tabular-nums">{s.turnCount}</td>
                  <td className="py-2.5 pr-4 text-slate-300 tabular-nums">{s.wordCount}</td>
                  <td className="py-2.5 pr-4 text-slate-300 tabular-nums">{s.avgWords}</td>
                  <td className="py-2.5 pr-4 text-slate-300 tabular-nums">{s.avgScore || '—'}</td>
                  <td className={`py-2.5 pr-4 tabular-nums ${s.userPoints > 0 ? 'text-emerald-400' : s.userPoints < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                    {s.userPoints > 0 ? '+' : ''}{s.userPoints || '—'}
                  </td>
                  <td className="py-2.5 text-slate-300 tabular-nums">{s.fallacyCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Best argument + highlights + fallacies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-dark rounded-2xl p-5 space-y-4">
          {bestTurn && (
            <div>
              <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-400" /> Highest-scored speech ({turnTotal(bestTurn)} pts)
              </h2>
              <p className="text-[11px] text-slate-500 mb-1">
                {config.participants.find((p) => p.id === bestTurn.participantId)?.displayName} — {PHASE_LABELS[bestTurn.phase]}
              </p>
              <p className="text-xs text-slate-300 leading-relaxed line-clamp-6">{bestTurn.text}</p>
            </div>
          )}
          {highlights.length > 0 && (
            <div>
              <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 text-amber-300" /> Your highlighted arguments
              </h2>
              <div className="space-y-2">
                {highlights.map((t) => (
                  <p key={t.id} className="text-xs text-slate-300 border-l-2 border-amber-400/50 pl-2 line-clamp-3">
                    <span className="text-slate-500">
                      {config.participants.find((p) => p.id === t.participantId)?.displayName}:
                    </span>{' '}
                    {t.judge?.claim ?? t.text.slice(0, 140)}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="glass-dark rounded-2xl p-5">
          <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Fallacies flagged ({allFallacies.length})
          </h2>
          {allFallacies.length === 0 ? (
            <p className="text-xs text-slate-500">The judge flagged no logical fallacies in this debate.</p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto custom-scrollbar pr-1">
              {allFallacies.map((f, i) => (
                <div key={i} className="text-[11px] border-l-2 border-amber-500/50 pl-2.5">
                  <p className="text-amber-300 font-medium">{f.type} — {f.speakerName}</p>
                  <p className="text-slate-400 italic">"{f.quote}"</p>
                  <p className="text-slate-500">{f.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Argument map replay */}
      <div className="glass-dark rounded-2xl h-[420px]">
        <ArgumentGraph session={session} />
      </div>

      {/* Exports */}
      <div className="glass-dark rounded-2xl p-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono uppercase tracking-widest text-slate-400 mr-2 flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> Export
        </span>
        <button onClick={() => exportMarkdown(session)} className="px-3 py-2 rounded-xl border border-slate-700 hover:border-indigo-500/50 hover:text-indigo-300 text-slate-300 text-xs flex items-center gap-1.5 transition">
          <FileText className="w-3.5 h-3.5" /> Markdown
        </button>
        <button onClick={() => exportJson(session)} className="px-3 py-2 rounded-xl border border-slate-700 hover:border-indigo-500/50 hover:text-indigo-300 text-slate-300 text-xs flex items-center gap-1.5 transition">
          <FileJson className="w-3.5 h-3.5" /> JSON
        </button>
        <button onClick={() => exportPdf(session)} className="px-3 py-2 rounded-xl border border-slate-700 hover:border-indigo-500/50 hover:text-indigo-300 text-slate-300 text-xs flex items-center gap-1.5 transition">
          <Printer className="w-3.5 h-3.5" /> PDF
        </button>
        <button onClick={onReset} className="ml-auto px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition">
          <RotateCcw className="w-3.5 h-3.5" /> New debate
        </button>
      </div>
    </div>
  );
}
