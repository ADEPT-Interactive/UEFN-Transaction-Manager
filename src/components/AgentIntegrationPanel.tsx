import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, Copy, FolderOpen, PlugZap, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { AgentIntegrationSetupResult, AgentIntegrationStatus } from '../services/fileService';
import { NumericInput } from './NumericInput';

type SupportedAgent = 'codex' | 'claude' | 'cursor';
type IntegrationIntent = 'connect' | 'migrate';

interface AgentIntegrationPanelProps {
  isOpen: boolean;
  status: AgentIntegrationStatus | null;
  intent?: IntegrationIntent;
  showcaseMode?: boolean;
  onRefresh: () => void;
  onUpdate: (input: { port?: number }) => Promise<{ success: boolean; status?: AgentIntegrationStatus; error?: string }>;
  onSetup: (agent: SupportedAgent) => Promise<AgentIntegrationSetupResult>;
  onOpenSkillLocation: (agent: SupportedAgent) => Promise<{ success: boolean; error?: string }>;
  onCopyConfig: () => Promise<{ success: boolean; config?: Record<string, unknown>; error?: string }>;
  onClose: () => void;
  appChromeHeight?: number;
}

const agents: Array<{ id: SupportedAgent; label: string; detail: string }> = [
  { id: 'codex', label: 'Codex', detail: 'User Agent Skill' },
  { id: 'claude', label: 'Claude Code', detail: 'User skill folder' },
  { id: 'cursor', label: 'Cursor', detail: 'User skill folder' },
];

export const AgentIntegrationPanel: React.FC<AgentIntegrationPanelProps> = ({ isOpen, status, intent = 'connect', showcaseMode = false, onRefresh, onUpdate, onSetup, onOpenSkillLocation, onCopyConfig, onClose, appChromeHeight = 0 }) => {
  const [port, setPort] = useState(status?.port ?? 8001);
  const [selectedAgent, setSelectedAgent] = useState<SupportedAgent>('codex');
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configurationCopied, setConfigurationCopied] = useState(false);

  useEffect(() => { if (status) setPort(status.port); }, [status?.port]);
  useEffect(() => { if (!isOpen) setConfigurationCopied(false); }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);
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

  const showMessage = (next: string, error = false) => {
    setMessage(next);
    setMessageIsError(error);
  };

  const update = async (input: { port?: number }, successMessage?: string) => {
    setBusy(true);
    try {
      if (input.port !== undefined) setConfigurationCopied(false);
      const result = await onUpdate(input);
      showMessage(result.success ? successMessage ?? 'Agent Integration updated.' : result.error ?? 'Agent Integration could not be updated.', !result.success);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Agent Integration could not be updated.', true);
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const setup = async () => {
    setBusy(true);
    try {
      const result = await onSetup(selectedAgent);
      if (!result.success) {
        showMessage(result.error ?? 'Agent setup could not be completed.', true);
        return;
      }
      let configCopied = false;
      if (result.config) {
        try {
          await copyText(JSON.stringify(result.config, null, 2));
          configCopied = true;
        } catch {
          // The fallback connection details remain available below.
        }
      }
      if (configCopied) setConfigurationCopied(true);
      showMessage(configCopied
        ? `${agents.find(agent => agent.id === selectedAgent)?.label} skill installed and MCP configuration copied. Restart or reload that agent, then ask it to verify this project.`
        : `${agents.find(agent => agent.id === selectedAgent)?.label} skill installed. The configuration was not copied automatically; use Copy MCP configuration below, then restart or reload that agent.`);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Agent setup could not be completed.', true);
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const copyConfig = async () => {
    setBusy(true);
    try {
      const result = await onCopyConfig();
      if (result.success && result.config) {
        await copyText(JSON.stringify(result.config, null, 2));
        setConfigurationCopied(true);
        showMessage('MCP configuration copied. Replace any stale UTM entry and restart or reload the coding agent.');
      } else showMessage(result.error ?? 'Configuration could not be copied.', true);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Configuration could not be copied.', true);
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const copySkillPath = async () => {
    const skillPath = status?.skillPath ?? 'resources/agent-skills/uefn-transaction-manager';
    try {
      await copyText(skillPath);
      showMessage('Packaged skill source location copied for manual setup.');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Agent Skill location could not be copied.', true);
    }
  };

  const copySkillInstructions = async () => {
    const skillPath = status?.skillPath ?? 'resources/agent-skills/uefn-transaction-manager';
    try {
      await copyText(`UEFN Transaction Manager Agent Skill\n\nRecommended: use the guided setup in this panel for Codex, Claude Code, or Cursor. It installs only the UTM-owned skill folder and gives you the local MCP connection details. Restart or reload the coding agent after setup.\n\nManual fallback: copy the entire folder, including SKILL.md and references, into the client’s user skill directory.\n\nPackaged source: ${skillPath}`);
      showMessage('Manual Agent Skill instructions copied.');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Agent Skill instructions could not be copied.', true);
    }
  };

  const openSkillLocation = async () => {
    if (!hasVerifiedSkillLocation) {
      showMessage('Install and verify this Agent Skill before opening its location.', true);
      return;
    }
    try {
      const result = await onOpenSkillLocation(selectedAgent);
      showMessage(result.success ? `${agentLabel} skill location opened.` : result.error ?? 'The verified skill location could not be opened.', !result.success);
      if (!result.success) onRefresh();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'The verified skill location could not be opened.', true);
      onRefresh();
    }
  };

  const selectedInstallation = status?.skillInstallations?.find(installation => installation.id === selectedAgent);
  const agentLabel = agents.find(agent => agent.id === selectedAgent)?.label ?? 'coding agent';
  const displayedSkillPath = showcaseMode ? 'Included with this development build' : (status?.skillPath ?? 'resources/agent-skills/uefn-transaction-manager');
  const serverState = status?.running ? 'Running' : 'Unavailable';
  const serverTone = status?.running ? 'emerald' : 'amber';
  const connectionVerified = status?.clientConnection?.state === 'verified';
  const hasVerifiedSkillLocation = Boolean(selectedInstallation?.installed && !selectedInstallation.error && selectedInstallation.targetPath);
  const overlayTop = Math.max(16, appChromeHeight + 16);

  return (
    <div data-app-chrome-aware="true" className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center overflow-hidden bg-black/80 p-3 backdrop-blur-sm sm:p-4" style={{ top: `${overlayTop}px` }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="agent-integration-title" className="flex max-h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-[#0d1326] shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-800 bg-slate-900/95 px-6 py-5 backdrop-blur">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10 text-violet-200"><PlugZap className="h-5 w-5" /></div><div><h2 id="agent-integration-title" className="text-lg font-extrabold text-white">{intent === 'migrate' ? 'Migrate existing transactions' : 'Connect an AI coding agent'}</h2><p className="text-xs text-slate-400">{intent === 'migrate' ? 'Bring an existing in-island transaction layer under safe UTM management.' : 'Work with this project’s transaction catalog through your coding agent.'}</p></div></div>
          <button type="button" aria-label="Close Agent Integration" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:#334155_transparent] [scrollbar-width:thin]"><div className="space-y-4 p-6 text-xs">
          <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-200" /><div><p className="font-extrabold text-violet-100">{intent === 'migrate' ? 'Your existing project does not need to be rebuilt by hand.' : 'Use UTM from the tools you already use.'}</p><p className="mt-1 leading-5 text-slate-300">{intent === 'migrate' ? 'Your agent can inspect the existing Verse, map confirmed transactions into UTM, reuse project icons, update the integration, and compile the result. It pauses only when the meaning of a transaction needs your decision.' : 'Your agent can manage transaction data through UTM MCP and work with the project through Unreal MCP.'}</p></div></div></div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
            <div className="flex items-center justify-between gap-3"><div><p className="font-extrabold text-white">Set up your coding agent</p><p className="mt-1 text-[11px] leading-4 text-slate-400">UTM installs only its own skill folder, prepares the current project’s MCP entry, and tells you when a reload is required.</p></div><span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-200">Recommended</span></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">{agents.map(agent => {
              const installation = status?.skillInstallations?.find(candidate => candidate.id === agent.id);
              const selected = selectedAgent === agent.id;
              return <button key={agent.id} type="button" onClick={() => setSelectedAgent(agent.id)} aria-pressed={selected} className={`rounded-xl border p-3 text-left transition ${selected ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'}`}><span className="flex items-center justify-between gap-2"><span className="font-extrabold text-white">{agent.label}</span>{installation?.upToDate ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}</span><span className="mt-1 block text-[10px] text-slate-500">{installation?.upToDate ? 'Skill up to date' : agent.detail}</span></button>;
            })}</div>
            <button type="button" disabled={busy || !status} onClick={() => void setup()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 font-extrabold text-slate-950 hover:bg-cyan-300 disabled:opacity-40"><PlugZap className="h-4 w-4" />{selectedInstallation?.upToDate && status?.running ? `Prepare ${agentLabel} again` : `Set up ${agentLabel}`}</button>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">UTM runs locally for this project. A coding agent that was already open must reload its configuration or start a fresh session before it can see a new MCP entry.</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><div className="flex items-center justify-between"><p className="font-extrabold text-white">Connection readiness</p><button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-300 hover:text-cyan-200"><RefreshCw className="h-3.5 w-3.5" />Refresh</button></div><div className="mt-3 grid items-stretch gap-2 sm:grid-cols-2"><ReadinessRow label="UTM MCP" value={serverState} tone={serverTone} detail={status?.running ? status.endpoint : status?.unavailableReason ?? 'UTM MCP starts automatically with the project bridge.'} /><ReadinessRow label={`${agentLabel} Agent Skill`} value={selectedInstallation?.upToDate ? 'Installed' : selectedInstallation?.installed ? 'Update available' : 'Not installed'} tone={selectedInstallation?.upToDate ? 'emerald' : 'amber'} detail={selectedInstallation?.error} action={hasVerifiedSkillLocation ? <button type="button" onClick={() => void openSkillLocation()} className="mt-auto inline-flex items-center gap-1.5 self-start pt-3 text-[10px] font-extrabold text-cyan-300 hover:text-cyan-200"><FolderOpen className="h-3.5 w-3.5" />Open skill location</button> : undefined} /><ReadinessRow label="Agent setup" value={configurationCopied ? 'Ready in this session' : status?.configuration?.available ? 'Ready to copy' : 'Waiting for UTM MCP'} tone={status?.configuration?.available ? 'cyan' : 'slate'} detail={status?.configuration?.restartRequired ? 'Reload or restart the agent after adding this MCP entry.' : 'Use the local endpoint shown below.'} /><ReadinessRow label="Agent connection" value={connectionVerified ? 'Verified' : status?.clientConnection?.state === 'connected' ? 'Connected; verify project' : 'Not verified'} tone={connectionVerified ? 'emerald' : status?.clientConnection?.state === 'connected' ? 'amber' : 'slate'} detail={connectionVerified ? `Verified by ${status?.clientConnection?.clientName ?? 'the MCP client'} at ${status?.clientConnection?.verifiedAt ?? ''}` : status?.clientConnection?.message ?? (status?.configuration?.restartRequired ? 'Reload or restart the agent, then ask it to call get_project_context.' : 'The agent must call get_project_context before UTM can verify the client connection.')} /></div></div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4"><div className="flex items-center justify-between gap-3"><p className="font-extrabold text-cyan-100">Keep both project connections aligned</p><span className="rounded-full border border-cyan-500/25 px-2 py-1 text-[10px] font-bold text-cyan-200">Required before edits</span></div><p className="mt-2 text-[11px] leading-5 text-slate-300">Connect the agent to both <strong className="text-white">utm-mcp</strong> and Epic’s <strong className="text-white">unreal-mcp</strong>. The Agent Skill will compare their project identities before any catalog mutation or Verse edit.</p><p className="mt-2 text-[11px] text-slate-400">Active UTM project: <span className="font-bold text-slate-200">{status?.projectName ?? 'this open project'}</span></p></div>

          {status?.unavailableReason && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">{status.unavailableReason}</p>}

          <details className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4"><summary className="cursor-pointer list-none font-bold text-slate-200">Connection details <span className="ml-2 text-[10px] font-normal text-slate-500">endpoint and manual fallback</span></summary><div className="mt-3 space-y-3"><div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3"><div className="flex items-center justify-between gap-3"><p className="font-bold text-cyan-200">UTM MCP endpoint</p><code className="rounded bg-slate-950/60 px-2 py-1 text-[10px] text-slate-300">utm-mcp · http</code></div><code className="mt-2 block break-all rounded-lg bg-slate-950/70 px-2 py-1.5 font-mono text-[11px] text-cyan-300">{status?.endpoint ?? 'http://127.0.0.1:8001/mcp'}</code></div><button type="button" disabled={busy || !status?.running} onClick={() => void copyConfig()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-3 py-2.5 font-extrabold text-slate-950 hover:bg-cyan-300 disabled:opacity-40"><Copy className="h-4 w-4" />Copy MCP configuration</button></div></details>

          <details className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4"><summary className="cursor-pointer list-none font-bold text-slate-200">Advanced connection settings <span className="ml-2 text-[10px] font-normal text-slate-500">local port only</span></summary><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">MCP port</span><NumericInput ariaLabel="Advanced MCP port" min={1024} max={65535} value={port} onChange={setPort} className="w-24" /></label><button type="button" disabled={busy || !Number.isInteger(port) || port < 1024 || port > 65535} onClick={() => void update({ port }, 'MCP port updated. Copy a fresh configuration for the new endpoint.')} className="self-end rounded-xl border border-slate-700 px-3 py-2 font-bold text-slate-200 hover:border-cyan-400 disabled:opacity-40">Apply port</button></div><p className="mt-2 text-[11px] leading-4 text-slate-500">Use another loopback port only when the default is occupied. Changing the port stops the old listener and makes old endpoint configuration unusable.</p></details>

          <details className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4"><summary className="cursor-pointer list-none font-bold text-slate-200">Safety and manual setup <span className="ml-2 text-[10px] font-normal text-slate-500">for unusual clients</span></summary><div className="mt-3 space-y-3"><div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-[11px] text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><span>UTM MCP is available only through this machine’s loopback interface and checks the local Host and Origin. Project identity, revision checks, managed assets, and the authenticated internal editor bridge still protect changes.</span></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Packaged skill source</p><code className="mt-1 block break-all rounded-lg bg-slate-950/60 px-2 py-1.5 font-mono text-[11px] text-violet-200">{displayedSkillPath}</code><div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => void copySkillPath()} className="font-bold text-cyan-300 hover:text-cyan-200">Copy source path</button><button type="button" onClick={() => void copySkillInstructions()} className="font-bold text-cyan-300 hover:text-cyan-200">Copy manual instructions</button></div></div></div></details>

          {message && <p role="status" className={`flex items-start gap-1.5 rounded-xl border p-3 text-[11px] ${messageIsError ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-slate-700 bg-slate-950/40 text-slate-300'}`}><CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${messageIsError ? 'text-rose-300' : 'text-cyan-300'}`} />{message}</p>}
        </div></div>
      </section>
    </div>
  );
};

const ReadinessRow: React.FC<{ label: string; value: string; tone: 'emerald' | 'amber' | 'cyan' | 'slate'; detail?: string; action?: React.ReactNode }> = ({ label, value, tone, detail, action }) => {
  const toneClass = tone === 'emerald' ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200' : tone === 'amber' ? 'border-amber-500/25 bg-amber-500/5 text-amber-200' : tone === 'cyan' ? 'border-cyan-500/25 bg-cyan-500/5 text-cyan-200' : 'border-slate-800 bg-slate-900/40 text-slate-300';
  return <div className={`flex h-full min-h-[96px] flex-col rounded-xl border p-3 ${toneClass}`}><div className="flex items-start justify-between gap-2"><span className="font-bold text-white">{label}</span><span className="shrink-0 text-right text-[10px] font-extrabold uppercase tracking-wide">{value}</span></div>{detail && <p className="mt-1 break-words text-[10px] leading-4 opacity-80">{detail}</p>}{action}</div>;
};
