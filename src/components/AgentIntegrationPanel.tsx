import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, PlugZap, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { AgentIntegrationStatus } from '../services/fileService';

interface AgentIntegrationPanelProps {
  isOpen: boolean;
  status: AgentIntegrationStatus | null;
  onRefresh: () => void;
  onUpdate: (input: { enabled?: boolean; port?: number; refreshConnection?: boolean; includeToken?: boolean }) => Promise<{ success: boolean; token?: string; error?: string }>;
  onCopyConfig: () => Promise<{ success: boolean; config?: Record<string, unknown>; error?: string }>;
  onClose: () => void;
}

export const AgentIntegrationPanel: React.FC<AgentIntegrationPanelProps> = ({ isOpen, status, onRefresh, onUpdate, onCopyConfig, onClose }) => {
  const [port, setPort] = useState(status?.port ?? 8001);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status) setPort(status.port); }, [status?.port]);
  if (!isOpen) return null;

  const update = async (input: { enabled?: boolean; port?: number; refreshConnection?: boolean; includeToken?: boolean }, successMessage?: string) => {
    setBusy(true);
    const result = await onUpdate(input);
    setBusy(false);
    setMessage(result.success ? successMessage ?? 'Agent Integration updated.' : result.error ?? 'Agent Integration could not be updated.');
    onRefresh();
  };

  const copyConfig = async () => {
    setBusy(true);
    const result = await onCopyConfig();
    if (result.success && result.config) {
      await navigator.clipboard?.writeText(JSON.stringify(result.config, null, 2));
      setMessage('MCP client configuration copied. Keep it private because it contains the bearer token.');
    } else setMessage(result.error ?? 'Configuration could not be copied.');
    setBusy(false);
  };

  const copySkillPath = async () => {
    const skillPath = status?.skillPath ?? 'skills/uefn-transaction-manager';
    await navigator.clipboard?.writeText(skillPath);
    setMessage('Agent Skill location copied.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="agent-integration-title" className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-700 bg-[#0d1326] shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 bg-slate-900/70 px-6 py-5">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"><PlugZap className="h-5 w-5" /></div><div><h2 id="agent-integration-title" className="text-base font-extrabold text-white">Agent Integration</h2><p className="text-xs text-slate-400">Transaction-domain MCP for this open project</p></div></div>
          <button type="button" aria-label="Close Agent Integration" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-6 text-xs">
          <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><div><p className="font-bold text-white">UTM MCP</p><p className="mt-1 text-slate-400">Agents can manage catalog state, validation, generated integration, and controlled icons. Epic unreal-mcp remains the UEFN editor server.</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${status?.running ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>{status?.running ? 'Running' : status?.enabled ? 'Unavailable' : 'Disabled'}</span></div>
          <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><span><strong className="block text-white">Enable UTM MCP</strong><span className="text-[11px] text-slate-500">Off by default for existing users. The listener is loopback-only and project-scoped.</span></span><input aria-label="Enable UTM MCP" type="checkbox" checked={status?.enabled ?? false} disabled={busy} onChange={event => void update({ enabled: event.target.checked }, event.target.checked ? 'UTM MCP enabled.' : 'UTM MCP disabled.')} className="h-4 w-4 accent-cyan-500" /></label>
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4"><p className="font-bold text-cyan-200">Endpoint</p><code className="mt-1 block break-all rounded-lg bg-slate-950/70 px-2 py-1.5 font-mono text-[11px] text-cyan-300">{status?.endpoint ?? 'http://127.0.0.1:8001/mcp'}</code><p className="mt-2 text-[11px] text-slate-400">Server name <code className="text-slate-300">utm-mcp</code>{status?.projectName ? ` · ${status.projectName}` : ''}</p></div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Advanced MCP port</span><input type="number" min={1024} max={65535} value={port} onChange={event => setPort(Number(event.target.value))} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white" /></label><button type="button" disabled={busy || !Number.isInteger(port) || port < 1024 || port > 65535} onClick={() => void update({ port }, 'MCP port updated.')} className="self-end rounded-xl border border-slate-700 px-3 py-2 font-bold text-slate-200 hover:border-cyan-400 disabled:opacity-40">Apply port</button></div>
          {status?.unavailableReason && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">{status.unavailableReason}</p>}
          <div className="grid gap-2 sm:grid-cols-2"><button type="button" disabled={busy || !status?.enabled} onClick={() => void copyConfig()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-3 py-2.5 font-extrabold text-slate-950 hover:bg-cyan-300 disabled:opacity-40"><Copy className="h-4 w-4" />Copy MCP config</button><button type="button" disabled={busy || !status?.enabled} onClick={() => void update({ refreshConnection: true }, 'Token rotated. Existing client configurations are now invalid.')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 font-bold text-slate-200 hover:border-amber-400 hover:text-amber-200 disabled:opacity-40"><KeyRound className="h-4 w-4" />Rotate token</button></div>
          <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-[11px] text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><span>Bearer tokens are stored in private local application state and are never placed in project files, generated Verse, or diagnostics. Copying configuration includes the token only because you explicitly requested it.</span></div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3"><span className="min-w-0 text-[11px] text-slate-500">Agent Skill: <code className="break-all text-cyan-300">{status?.skillPath ?? 'skills/uefn-transaction-manager'}</code></span><span className="flex shrink-0 items-center gap-3"><button type="button" onClick={() => void copySkillPath()} className="font-bold text-cyan-300 hover:text-cyan-200">Copy path</button><button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-300 hover:text-cyan-200"><RefreshCw className="h-3.5 w-3.5" />Refresh</button></span></div>
          {message && <p role="status" className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-[11px] text-slate-300"><CheckCircle2 className="h-4 w-4 text-cyan-300" />{message}</p>}
        </div>
      </section>
    </div>
  );
};
