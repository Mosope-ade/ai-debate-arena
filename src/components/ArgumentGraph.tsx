import { useMemo } from 'react';
import {
  Background,
  Edge,
  Handle,
  Node,
  Position,
  ReactFlow,
  Controls,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Session, speechTurns, Turn, PHASE_LABELS } from '../types';
import { colorClasses } from '../lib/ui';
import { AlertTriangle, MessageSquare } from 'lucide-react';

interface ArgumentGraphProps {
  session: Session;
}

function ClaimNode({ data }: { data: any }) {
  return (
    <div
      className="rounded-xl border glass-dark p-3 w-[240px] text-left"
      style={{ borderColor: `${data.hex}66`, boxShadow: `0 0 14px ${data.hex}1f` }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider truncate" style={{ color: data.hex }}>
          {data.speakerName}
        </span>
        <span className="text-[9px] text-slate-500 uppercase shrink-0 ml-2">{data.phaseLabel}</span>
      </div>
      <p className="text-[11px] text-slate-200 leading-snug">{data.claim}</p>
      <div className="flex items-center gap-2 mt-2">
        {typeof data.score === 'number' && (
          <span className="text-[10px] text-slate-400 tabular-nums">{data.score} pts</span>
        )}
        {data.fallacies > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-300">
            <AlertTriangle className="w-2.5 h-2.5" /> {data.fallacies}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { claim: ClaimNode };

export default function ArgumentGraph({ session }: ArgumentGraphProps) {
  const { config, turns } = session;

  const { nodes, edges } = useMemo(() => {
    const speeches = speechTurns(turns).filter((t) => t.text.trim());
    const colIndex = new Map(config.participants.map((p, i) => [p.id, i]));
    const colWidth = 300;
    const rowHeight = 170;
    const xOffset = (cols: number) => Math.max(0, ((4 - cols) * colWidth) / 4);

    const nodes: Node[] = speeches.map((t, row) => {
      const p = config.participants.find((x) => x.id === t.participantId);
      const col = colIndex.get(t.participantId ?? '') ?? 0;
      const hex = p ? colorClasses[p.color].hex : '#818cf8';
      return {
        id: t.id,
        type: 'claim',
        position: {
          x: xOffset(config.participants.length) + col * colWidth + 20,
          y: row * rowHeight + 20,
        },
        data: {
          speakerName: p?.displayName ?? '?',
          phaseLabel: `${PHASE_LABELS[t.phase]}${t.round ? ` R${t.round}` : ''}`,
          claim: t.judge?.claim ?? truncate(t.text, 110),
          score: t.judge ? avgScore(t) : undefined,
          fallacies: t.judge?.fallacies.length ?? 0,
          hex,
        },
      };
    });

    // Each speech (after the first) responds to the previous speech in sequence.
    const edges: Edge[] = speeches.slice(1).map((t, i) => ({
      id: `e-${speeches[i].id}-${t.id}`,
      source: speeches[i].id,
      target: t.id,
      animated: i === speeches.length - 2,
    }));

    return { nodes, edges };
  }, [turns, config.participants]);

  if (nodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <MessageSquare className="w-6 h-6 text-slate-600 mb-2" />
        <p className="text-sm text-slate-400">The argument map grows as the debate unfolds.</p>
        <p className="text-[11px] text-slate-600 mt-1">
          Each node is a speech's core claim as identified by the judge, linked in response order.
        </p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
    >
      <Background gap={24} size={1} color="rgba(99,102,241,0.12)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function truncate(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n).trimEnd()}…` : text;
}

function avgScore(t: Turn): number {
  const s = t.judge!.scores;
  return Math.round((s.logic + s.evidence + s.relevance + s.persuasiveness + s.consistency) / 5);
}
