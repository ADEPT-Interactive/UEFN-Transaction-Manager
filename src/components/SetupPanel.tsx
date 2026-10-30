import React, { useEffect, useId, useRef, useState } from 'react';
import { Code2, ExternalLink, X } from 'lucide-react';
import type { BundleOffer, EntitlementItem, ProjectConfig, StorefrontMembership } from '../types/entitlement';
import { handleExternalLinkClick } from '../services/externalLink';
import { CREATING_ITEMS_AND_OFFERS_URL, IN_ISLAND_TRANSACTIONS_URL, TRANSACTION_BEST_PRACTICES_URL } from '../constants/docs';
import { useModalFocus } from '../hooks/useModalFocus';
import { CopyCode, VerseApiReference } from './VerseApiReference';

interface SetupPanelProps {
  config: ProjectConfig;
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  storefrontMembership: StorefrontMembership;
}

export const SetupPanel: React.FC<Pick<SetupPanelProps, 'config' | 'entitlements' | 'storefrontMembership'>> = ({ config }) => {
  const reference = `@editable\nTransactions : ${config.deviceClassName} = ${config.deviceClassName}{}\n\n# In a player-driven callback:\nTransactions.OpenAllOffersStore(Player)`;
  return <div className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed text-slate-300">
    <section className="rounded-xl border border-slate-800 p-4"><h3 className="font-semibold text-white">1. Enable the editor connection</h3><p className="mt-2 text-slate-400">In UEFN, open the Project menu (palm tree icon) → Project Settings, then under <strong className="text-slate-200">Beta Access</strong> turn on <strong className="text-slate-200">Python Editor Scripting</strong>. Keep the linked project open; UTM connects automatically when the editor is ready.</p></section>
    <section className="rounded-xl border border-slate-800 p-4"><h3 className="font-semibold text-white">2. Compile and place the manager</h3><p className="mt-2 text-slate-400">Use <strong className="text-slate-200">Compile</strong> in UTM to save and build your Verse. After a successful build, find <code className="text-cyan-200">{config.deviceClassName}</code> in UEFN and drag one instance into the level.</p></section>
    <section className="rounded-xl border border-slate-800 p-4"><h3 className="font-semibold text-white">3. Connect your gameplay</h3><p className="mt-2 text-slate-400">For device wiring, select the placed manager and assign Trigger or Button devices to its arrays in Details. Find each enabled array under the item’s <strong className="text-slate-200">Device wiring</strong> section in Functions &amp; events.</p><p className="mt-3 text-slate-400">For Verse, add this editable reference inside your own gameplay device. Assign the placed manager to <code>Transactions</code> in that device’s Details.</p><div className="mt-3 rounded-lg bg-[#080d19] p-3"><div className="mb-2 flex justify-end"><CopyCode text={reference} label="Copy manager reference" /></div><pre className="overflow-x-auto text-[13px] leading-6 text-emerald-200">{reference}</pre></div><p className="mt-3 text-slate-400">Browse an item’s functions, events, and complete callback example in <strong className="text-slate-200">Functions &amp; events</strong>. Keep gameplay code in your own file so UTM can safely regenerate the managed transaction file.</p></section>
    <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-slate-800 pt-4 text-xs">{[[IN_ISLAND_TRANSACTIONS_URL, 'Epic: In-Island Transactions'], [CREATING_ITEMS_AND_OFFERS_URL, 'Creating Items & Offers'], [TRANSACTION_BEST_PRACTICES_URL, 'Best practices & debugging']].map(([url, label]) => <a key={url} href={url} target="_blank" rel="noreferrer" onClick={event => handleExternalLinkClick(event, url)} className="inline-flex items-center gap-1 text-cyan-300 hover:underline">{label}<ExternalLink className="h-3 w-3" /></a>)}</div>
  </div>;
};

export const SetupModal: React.FC<SetupPanelProps & { open: boolean; onClose: () => void; initialItemId?: string | null }> = ({ open, onClose, initialItemId, ...panelProps }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'api' | 'setup'>('api');
  const [selectedId, setSelectedId] = useState<string | null>(initialItemId ?? null);
  useModalFocus({ open, dialogRef, onEscape: onClose });
  useEffect(() => { if (open) { setTab('api'); setSelectedId(initialItemId ?? null); if (bodyRef.current) bodyRef.current.scrollTop = 0; } }, [open, initialItemId]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-4" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="animate-modal flex h-[84vh] max-h-[900px] min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0d1326] shadow-2xl outline-none">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-5 py-4"><div className="flex items-center gap-3"><Code2 className="h-6 w-6 shrink-0 text-cyan-300" /><div><h2 id={titleId} className="text-lg font-bold text-white">Verse API</h2><p className="mt-1 text-xs text-slate-400">Your catalog’s functions, events, and device connections.</p></div></div><button type="button" aria-label="Close Verse API" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></header>
      <nav aria-label="Verse API views" className="flex shrink-0 gap-2 border-b border-slate-800 px-5 py-2">{(['api', 'setup'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => { setTab(value); if (bodyRef.current) bodyRef.current.scrollTop = 0; }} className={`rounded-lg px-3 py-2 text-xs font-semibold ${tab === value ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{value === 'api' ? 'Functions & events' : 'Device setup'}</button>)}</nav>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{tab === 'api' ? <VerseApiReference {...panelProps} selectedId={selectedId} onSelect={id => { setSelectedId(id); if (bodyRef.current) bodyRef.current.scrollTop = 0; }} /> : <SetupPanel {...panelProps} />}</div>
    </div>
  </div>;
};
