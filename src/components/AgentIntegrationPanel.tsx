import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, PlugZap, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { AgentIntegrationStatus } from '../services/fileService';

interface AgentIntegrationPanelProps {
  isOpen: boolean;
  status: AgentIntegrationStatus | null;
  showcaseMode?: boolean;
  onRefresh: () => void;
  onUpdate: (input: { enabled?: boolean; port?: number; refreshConnection?: boolean; includeToken?: boolean }) => Promise<{ success: boolean; token?: string; error?: string }>;
  onCopyConfig: () => Promise<{ success: boolean; config?: Record<string, unknown>; error?: string }>;
  onClose: () => void;
}

export const AgentIntegrationPanel: React.FC<AgentIntegrationPanelProps> = ({ isOpen, status, showcaseMode = false, onRefresh, onUpdate, onCopyConfig, onClose }) => {
  const [port, setPort] = useState(status?.port ?? 8001);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status) setPort(status.port); }, [status?.port]);
  if (!isOpen) return null;

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(text),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Clipboard access timed out.')), 1500)),
        ]);
        return;
      }
    } catch {
      // Electron builds can expose a clipboard promise that never resolves. Fall back to the DOM path.
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard access is unavailable.');
  };

  const update = async (input: { enabled?: boolean; port?: number; refreshConnection?: boolean; includeToken?: boolean }, successMessage?: string) => {
    setBusy(true);
    const result = await onUpdate(input);
    setBusy(false);
    setMessage(result.success ? successMessage ?? 'Agent Integration updated.' : result.error ?? 'Agent Integration could not be updated.');
    onRefresh();
  };

  const copyConfig = async () => {
    setBusy(true);
    try {
      const result = await onCopyConfig();
      if (result.success && result.config) {
        await copyText(JSON.stringify(result.config, null, 2));
        setMessage('MCP client configuration copied. Keep it private because it contains the bearer token.');
      } else setMessage(result.error ?? 'Configuration could not be copied.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Configuration could not be copied.');
    } finally {
      setBusy(false);
    }
  };

  const copySkillPath = async () => {
    const skillPath = status?.skillPath ?? 'skills/uefn-transaction-manager';
    try {
      await copyText(skillPath);
      setMessage('Agent Skill location copied.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Agent Skill location could not be copied.');
    }
  };

  const copySkillInstructions = async () => {
    const skillPath = status?.skillPath ?? 'skills/uefn-transaction-manager';
    try {
      await copyText(`UEFN Transaction Manager Agent Skill\n\nMCP compatibility and Agent Skill support are separate. Add the copied UTM MCP entry to your client, then copy this entire folder with SKILL.md and references together into one of these client locations:\n\nCodex (user): %USERPROFILE%\\.agents\\skills\\uefn-transaction-manager\\\nClaude Code (user): %USERPROFILE%\\.claude\\skills\\uefn-transaction-manager\\\nCursor (user): %USERPROFILE%\\.cursor\\skills\\uefn-transaction-manager\\\n\nConnect the agent to both UTM MCP and UEFN MCP for the same project.\n\nSkill folder: ${skillPath}`);
      setMessage('Agent Skill setup instructions copied.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Agent Skill instructions could not be copied.');
    }
  };

  const displayedSkillPath = showcaseMode ? 'Included with this development build' : (status?.skillPath ?? 'skills/uefn-transaction-manager');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="agent-integration-title" className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto overflow-x-hidden rounded-3xl border border-slate-700 bg-[#0d1326] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-5 backdrop-blur">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"><PlugZap className="h-5 w-5" /></div><div><h2 id="agent-integration-title" className="text-lg font-extrabold text-white">Agent Integration</h2><p className="text-xs text-slate-400">Connect a coding agent to this project&apos;s transaction catalog</p></div></div>
          <button type="button" aria-label="Close Agent Integration" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-6 text-xs">
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4"><p className="font-bold text-cyan-200">Connect in a few clicks</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 font-black text-slate-950">1</span><p className="mt-2 font-bold text-white">Open UEFN MCP</p><p className="mt-1 text-[11px] leading-4 text-slate-400">Enable Epic&apos;s Unreal MCP for this same project.</p></div><div><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 font-black text-slate-950">2</span><p className="mt-2 font-bold text-white">Enable UTM MCP</p><p className="mt-1 text-[11px] leading-4 text-slate-400">Turn on the transaction server below.</p></div><div><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 font-black text-slate-950">3</span><p className="mt-2 font-bold text-white">Copy configuration</p><p className="mt-1 text-[11px] leading-4 text-slate-400">Give your MCP-compatible agent the local UTM endpoint.</p></div></div></div>
          <div className="grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex items-center justify-between gap-3"><p className="font-bold text-white">UTM MCP</p><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${status?.running ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>{status?.running ? 'Running' : status?.enabled ? 'Unavailable' : 'Disabled'}</span></div><p className="mt-2 text-[11px] leading-4 text-slate-400">Catalog, validation, generated integration, and controlled Texture2D adoption for this project.</p></div><div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><p className="font-bold text-white">UEFN MCP</p><p className="mt-2 text-[11px] leading-4 text-slate-400">Epic&apos;s separate editor connection for Verse, assets, devices, compilation, and sessions.</p></div></div>
          <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><span><strong className="block text-white">Enable UTM MCP</strong><span className="text-[11px] text-slate-500">Off by default for existing users. The listener is loopback-only and scoped to the open project.</span></span><input aria-label="Enable UTM MCP" type="checkbox" checked={status?.enabled ?? false} disabled={busy} onChange={event => void update({ enabled: event.target.checked }, event.target.checked ? 'UTM MCP enabled.' : 'UTM MCP disabled.')} className="h-4 w-4 accent-cyan-500" /></label>
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4"><div className="flex items-center justify-between gap-3"><p className="font-bold text-cyan-200">UTM MCP connection</p><code className="rounded bg-slate-950/60 px-2 py-1 text-[10px] text-slate-300">utm-mcp</code></div><code className="mt-2 block break-all rounded-lg bg-slate-950/70 px-2 py-1.5 font-mono text-[11px] text-cyan-300">{status?.endpoint ?? 'http://127.0.0.1:8001/mcp'}</code><p className="mt-2 text-[11px] text-slate-400">Active project: <span className="text-slate-200">{status?.projectName ?? 'this open project'}</span></p></div>
          {status?.unavailableReason && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">{status.unavailableReason}</p>}
          <div className="grid gap-2 sm:grid-cols-2"><button type="button" disabled={busy || !status?.enabled} onClick={() => void copyConfig()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-3 py-2.5 font-extrabold text-slate-950 hover:bg-cyan-300 disabled:opacity-40"><Copy className="h-4 w-4" />Copy MCP configuration</button><button type="button" disabled={busy || !status?.enabled} onClick={() => void update({ refreshConnection: true }, 'Token rotated. Existing client configurations are now invalid.')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 font-bold text-slate-200 hover:border-amber-400 hover:text-amber-200 disabled:opacity-40"><KeyRound className="h-4 w-4" />Rotate token</button></div>
          <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-[11px] text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><span>Bearer tokens are stored in private local application state and are never placed in project files, generated Verse, or diagnostics. Copying configuration includes the token only because you explicitly requested it.</span></div>
          <details className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4"><summary className="cursor-pointer list-none font-bold text-slate-200">Advanced connection settings <span className="ml-2 text-[10px] font-normal text-slate-500">local port and token rotation</span></summary><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">MCP port</span><input aria-label="Advanced MCP port" type="number" min={1024} max={65535} value={port} onChange={event => setPort(Number(event.target.value))} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white" /></label><button type="button" disabled={busy || !Number.isInteger(port) || port < 1024 || port > 65535} onClick={() => void update({ port }, 'MCP port updated.')} className="self-end rounded-xl border border-slate-700 px-3 py-2 font-bold text-slate-200 hover:border-cyan-400 disabled:opacity-40">Apply port</button></div><p className="mt-2 text-[11px] leading-4 text-slate-500">Change this only when another local service is using the default port. Restarting the listener or rotating the token invalidates old client configuration.</p></details>
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-violet-200">Packaged UTM Agent Skill</p><p className="mt-1 text-[11px] leading-4 text-slate-400">The skill gives a compatible agent the safe workflow for same-project checks, revisions, catalog edits, icon adoption, migration, and verification.</p></div><span className="shrink-0 rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-[10px] font-bold text-violet-200">Included</span></div><code className="mt-3 block break-all rounded-lg bg-slate-950/60 px-2 py-1.5 font-mono text-[11px] text-violet-200">{displayedSkillPath}</code><div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => void copySkillPath()} className="font-bold text-cyan-300 hover:text-cyan-200">Copy skill path</button><button type="button" onClick={() => void copySkillInstructions()} className="font-bold text-cyan-300 hover:text-cyan-200">Copy setup instructions</button></div></div>
          <div className="flex items-center justify-end border-t border-slate-800 pt-3"><button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-300 hover:text-cyan-200"><RefreshCw className="h-3.5 w-3.5" />Refresh status</button></div>
          {message && <p role="status" className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-[11px] text-slate-300"><CheckCircle2 className="h-4 w-4 text-cyan-300" />{message}</p>}
        </div>
      </section>
    </div>
  );
};
