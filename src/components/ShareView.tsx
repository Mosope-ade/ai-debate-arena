import { Session, speechTurns, participantTotals, PHASE_LABELS, turnTotal } from '../types';
import { colorClasses, providerBadge } from '../lib/ui';
import { exportMarkdown, exportJson } from '../lib/exports';
import Analytics from './Analytics';
import { ExternalLink, FileJson, FileText, Swords } from 'lucide-react';

interface ShareViewProps {
  session: Session;
}

export default function ShareView({ session }: ShareViewProps) {
  const isCompleted = session.status === 'completed';
  const speeches = speechTurns(session.turns);

  const handleNewDebate = () => {
    window.location.hash = '';
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#020617] cyber-grid text-slate-200 font-sans flex flex-col">
      <header className="h-14 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md flex items-center justify-between px-4 md:px-6 sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Swords className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold tracking-tight text-slate-100">
            AI Debate Arena
          </span>
        </div>

        <div className="flex-1 mx-4 text-center hidden md:block min-w-0">
          <p className="text-xs text-slate-400 truncate">
            {isCompleted ? 'Shared debate' : 'Debate in progress — snapshot'}
            {' · '}"{session.config.topic}"
          </p>
        </div>

        <button
          onClick={handleNewDebate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 text-xs hover:border-indigo-400/60 hover:text-indigo-200 transition"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Start your own
        </button>
      </header>

      <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2.5 flex items-center justify-center gap-2 text-xs text-amber-300/80">
        <span>
          {isCompleted
            ? `Read-only · completed debate · ${new Date(session.completedAt!).toLocaleDateString()}`
            : `Snapshot · debate was in progress · ${speeches.length} speech${speeches.length !== 1 ? 'es' : ''} recorded`}
        </span>
      </div>

      <main className="flex-1 flex flex-col py-4">
        {isCompleted ? (
          <Analytics session={session} onReset={handleNewDebate} hideNewDebateButton />
        ) : (
          <InProgressView session={session} />
        )}
      </main>
    </div>
  );
}

function InProgressView({ session }: { session: Session }) {
  const totals = participantTotals(session);
  const { config } = session;

  return (
    <div className="max-w-4xl mx-auto px-4 w-full space-y-4">
      <div className="glass-dark rounded-2xl p-4 flex flex-wrap gap-3">
        {config.participants.map((p) => {
          const c = colorClasses[p.color];
          return (
            <div key={p.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${c.border} bg-slate-950/40`}>
              <span className={`text-sm font-display font-semibold ${c.text}`}>{p.displayName}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase ${providerBadge[p.provider]}`}>
                {p.provider}
              </span>
              <span className="text-xs text-slate-400 font-mono">{totals[p.id] ?? 0} pts</span>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        {session.turns.map((turn) => {
          if (turn.kind === 'moderator') {
            return (
              <div key={turn.id} className="border-l-2 border-slate-600 bg-slate-800/30 rounded-r-xl px-4 py-2.5">
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-0.5">Moderator</p>
                <p className="text-sm text-slate-300">{turn.text}</p>
              </div>
            );
          }
          const speaker = config.participants.find(p => p.id === turn.participantId);
          const c = speaker ? colorClasses[speaker.color] : colorClasses.indigo;
          return (
            <div key={turn.id} className={`rounded-2xl border p-4 bg-slate-950/40 ${c.border}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-display font-semibold ${c.text}`}>{speaker?.displayName}</span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                  {PHASE_LABELS[turn.phase]}{turn.round ? ` · R${turn.round}` : ''}
                </span>
                {turn.judge && (
                  <span className="ml-auto text-[11px] text-slate-400 tabular-nums">
                    {turnTotal(turn)} pts
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{turn.text}</p>
              {turn.judge && (
                <p className="text-[11px] text-slate-500 mt-2 italic">{turn.judge.claim}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="glass-dark rounded-2xl p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono uppercase tracking-widest text-slate-400 mr-2">Export</span>
        <button onClick={() => exportMarkdown(session)} className="px-3 py-2 rounded-xl border border-slate-700 hover:border-indigo-500/50 hover:text-indigo-300 text-slate-300 text-xs flex items-center gap-1.5 transition">
          <FileText className="w-3.5 h-3.5" /> Markdown
        </button>
        <button onClick={() => exportJson(session)} className="px-3 py-2 rounded-xl border border-slate-700 hover:border-indigo-500/50 hover:text-indigo-300 text-slate-300 text-xs flex items-center gap-1.5 transition">
          <FileJson className="w-3.5 h-3.5" /> JSON
        </button>
      </div>
    </div>
  );
}
