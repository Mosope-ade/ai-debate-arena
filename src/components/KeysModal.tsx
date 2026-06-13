import { useEffect, useState } from 'react';
import { PROVIDERS, ProviderId } from '../types';
import { getKeys, setKey } from '../lib/storage';
import { testKey } from '../lib/api';
import { providerBadge } from '../lib/ui';
import { CheckCircle2, KeyRound, Loader2, X, XCircle, ExternalLink, ShieldCheck } from 'lucide-react';

interface KeysModalProps {
  open: boolean;
  onClose: () => void;
  serverKeys: Partial<Record<ProviderId, boolean>>;
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; detail?: string };

export default function KeysModal({ open, onClose, serverKeys }: KeysModalProps) {
  const [keys, setKeysState] = useState<Partial<Record<ProviderId, string>>>({});
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({});

  useEffect(() => {
    if (open) {
      setKeysState(getKeys());
      setTests({});
    }
  }, [open]);

  if (!open) return null;

  const updateKey = (provider: ProviderId, value: string) => {
    setKeysState((prev) => ({ ...prev, [provider]: value }));
    setKey(provider, value);
    setTests((prev) => ({ ...prev, [provider]: { status: 'idle' } }));
  };

  const runTest = async (provider: ProviderId) => {
    setTests((prev) => ({ ...prev, [provider]: { status: 'testing' } }));
    try {
      const count = await testKey(provider);
      setTests((prev) => ({
        ...prev,
        [provider]: { status: 'ok', detail: `Connected — ${count} models available` },
      }));
    } catch (err: any) {
      setTests((prev) => ({
        ...prev,
        [provider]: { status: 'fail', detail: err.message || 'Connection failed' },
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-premium rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-display font-semibold text-lg text-slate-100 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-indigo-400" /> API keys
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              Keys are stored only in this browser and sent with each request to reach the
              provider. They are never saved on the server. For shared deployments, set keys
              as server environment variables instead.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400" aria-label="Close settings">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {PROVIDERS.map((p) => {
            const test = tests[p.id] ?? { status: 'idle' };
            const hasServerKey = serverKeys[p.id];
            return (
              <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${providerBadge[p.id]}`}>
                      {p.label}
                    </span>
                    {hasServerKey && (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <ShieldCheck className="w-3 h-3" /> server key configured
                      </span>
                    )}
                  </div>
                  <a
                    href={p.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-slate-500 hover:text-indigo-400 flex items-center gap-1"
                  >
                    Get a key <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={keys[p.id] ?? ''}
                    onChange={(e) => updateKey(p.id, e.target.value)}
                    placeholder={hasServerKey ? 'Optional — server key is used if blank' : `${p.label} API key`}
                    className="flex-1 px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
                  />
                  <button
                    onClick={() => runTest(p.id)}
                    disabled={test.status === 'testing' || (!keys[p.id]?.trim() && !hasServerKey)}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-slate-200 flex items-center gap-1.5 shrink-0"
                  >
                    {test.status === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Test'}
                  </button>
                </div>
                {test.status === 'ok' && (
                  <p className="mt-1.5 text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {test.detail}
                  </p>
                )}
                {test.status === 'fail' && (
                  <p className="mt-1.5 text-[11px] text-rose-400 flex items-start gap-1">
                    <XCircle className="w-3.5 h-3.5 mt-px shrink-0" /> {test.detail}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-[11px] text-slate-500">
          Tip: an OpenRouter key alone gives access to models from most providers through one API.
        </p>
      </div>
    </div>
  );
}
