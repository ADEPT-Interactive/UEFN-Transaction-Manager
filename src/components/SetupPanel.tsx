import React, { useEffect, useId, useRef } from 'react';
import { BookOpenCheck, ExternalLink, X } from 'lucide-react';
import { EntitlementItem, OfferDisplayGroup, ProjectConfig } from '../types/entitlement';
import { toPascalCase } from '../services/validator';
import { entitlementEditableNames, storefrontEditableName } from '../services/editableBindings';
import { handleExternalLinkClick } from '../services/externalLink';
import { CREATING_ITEMS_AND_OFFERS_URL, IN_ISLAND_TRANSACTIONS_URL, TRANSACTION_BEST_PRACTICES_URL } from '../constants/docs';

interface SetupPanelProps {
  config: ProjectConfig;
  entitlements: EntitlementItem[];
  offerDisplayGroups: OfferDisplayGroup[];
}

export const SetupPanel: React.FC<SetupPanelProps> = ({ config, entitlements, offerDisplayGroups }) => (
  <div className="space-y-3 text-xs text-slate-300">
    <ol className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
      <li className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3"><strong className="block text-cyan-300">1. Open your UEFN project</strong><span className="mt-1 block text-slate-400">Open the project you want to use with UEM.</span></li>
      <li className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3"><strong className="block text-cyan-300">2. Open the Project menu</strong><span className="mt-1 block text-slate-400">Click the Project dropdown with the small palm tree icon.</span></li>
      <li className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3"><strong className="block text-cyan-300">3. Open Project Settings</strong><span className="mt-1 block text-slate-400">Choose <strong>Project Settings</strong> from that menu.</span></li>
      <li className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3"><strong className="block text-cyan-300">4. Enable Python</strong><span className="mt-1 block text-slate-400">Scroll down, find <strong>Python Editor Scripting</strong>, and enable its checkbox. UEM detects it immediately; no restart is needed.</span></li>
    </ol>
    <div className="border-t border-slate-800 pt-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">After your first compile</p></div>
    <ol className="grid gap-2 text-[11px] sm:grid-cols-3">
      <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-cyan-300">1. Save &amp; compile</strong><span className="mt-1 block text-slate-400">The generated <code>{config.deviceClassName}</code> type becomes available only after a successful Verse build.</span></li>
      <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-cyan-300">2. Place one device</strong><span className="mt-1 block text-slate-400">Find the generated Verse device in UEFN and drag one instance into the level. Select it to expose its editable arrays.</span></li>
      <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-cyan-300">3. Wire or call it</strong><span className="mt-1 block text-slate-400">Assign Trigger devices to the arrays below, or reference the placed device from your own Verse and call its public functions.</span></li>
    </ol>
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px]"><strong className="text-white">Reference the placed manager from your own Verse device</strong><pre className="mt-2 overflow-x-auto rounded-lg bg-[#070a13] p-3 font-mono text-[10px] leading-4 text-emerald-200">{`@editable\nTransactions : ${config.deviceClassName} = ${config.deviceClassName}{}\n\n# In a player-driven callback:\nTransactions.OpenAllOffersStore(Player)`}</pre><p className="mt-2 text-slate-400">After placing both devices, select your gameplay device and assign the placed transaction-manager instance to <code>Transactions</code> in Details.</p></div>
    {entitlements.length === 0 ? (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-4 text-center text-slate-400">Create your first offer to see its exact Trigger array, purchase function, entitlement events, and consume/grant helpers here.</div>
    ) : (
      <>
        <p className="text-slate-400">Keep the generated file manager-owned. Put game-specific rewards in your own Verse device and use the public interface below.</p>
        {entitlements.map(item => {
          const pascal = toPascalCase(item.verseKey);
          const editableNames = entitlementEditableNames(item.verseKey);
          return (
            <div key={item.id} className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="text-white">{item.name || item.verseKey}</strong><code className="text-[10px] text-slate-500">{item.verseKey}</code></div>
              {item.triggers.generateTriggerBinding ? <p><code className="text-cyan-200">{editableNames.purchaseTriggers}</code>: assign one or more Trigger devices and connect them to a deliberate player purchase interaction.</p> : <p className="text-slate-400">No purchase Trigger device array is generated for this offer. Turn it on under Advanced → Triggers &amp; Hooks if you want no-code device wiring.</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">{item.triggers.generateButtonBinding && <span>Purchase Button: <code className="text-cyan-300">{editableNames.purchaseButtons}</code>. Interacting opens Epic&apos;s purchase interface.</span>}</div>
              <div className="grid gap-2 text-[11px] sm:grid-cols-2">
                <p><span className="block text-slate-500">Open from Verse</span><code className="text-emerald-200">Open{pascal}Purchase(Player)</code></p>
                <p><span className="block text-slate-500">Grant without V-Bucks (promotion/testing)</span><code className="text-emerald-200">Grant{pascal}(Player, Quantity)</code></p>
                {item.itemType === 'consumable' && <p><span className="block text-slate-500">Deduct after the reward is used</span><code className="text-emerald-200">Consume{pascal}(Player, Quantity)</code></p>}
                <p><span className="block text-slate-500">Observe every positive entitlement delta</span><code className="text-emerald-200">{pascal}_GrantedEvent.Subscribe(...)</code></p>
              </div>
            </div>
          );
        })}
        {offerDisplayGroups.length > 0 && <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3"><strong className="text-white">Focused storefronts</strong><p className="mt-1 text-[11px] text-slate-400">These display selected offers as individually purchasable cards. They are not bundles.</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{offerDisplayGroups.map(group => { const pascal = toPascalCase(group.verseKey); return <div key={group.id} className="rounded-lg bg-slate-950/50 p-2"><span className="block font-semibold text-white">{group.name}</span><code className="block text-[10px] text-emerald-200">Open{pascal}(Player)</code>{group.generateTriggerBinding && <span className="mt-1 block text-[10px] text-slate-500">Open trigger array: <code>{storefrontEditableName(group.verseKey)}</code></span>}</div>; })}</div></div>}
      </>
    )}
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-800 pt-3 text-[11px]">
      {[[IN_ISLAND_TRANSACTIONS_URL, 'In-Island Transactions overview'], [CREATING_ITEMS_AND_OFFERS_URL, 'Creating Items & Offers'], [TRANSACTION_BEST_PRACTICES_URL, 'Best practices & debugging']].map(([url, label]) => <a key={url} href={url} target="_blank" rel="noreferrer" onClick={event => handleExternalLinkClick(event, url)} className="flex items-center gap-1 text-cyan-400 hover:underline"><span>{label}</span><ExternalLink className="h-3 w-3" /></a>)}
    </div>
  </div>
);

export const SetupModal: React.FC<SetupPanelProps & { open: boolean; onClose: () => void }> = ({ open, onClose, ...panelProps }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="animate-modal max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-700 bg-[#0d1326] p-6 shadow-2xl outline-none">
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"><BookOpenCheck className="h-5 w-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">UEFN workflow</p><h2 id={titleId} className="mt-0.5 text-xl font-extrabold text-white">Need Help?</h2><p className="mt-1 text-xs text-slate-400">Enable Python, then compile, place, and connect your generated transaction device.</p></div></div>
          <button type="button" aria-label="Close help" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <SetupPanel {...panelProps} />
      </div>
    </div>
  );
};
