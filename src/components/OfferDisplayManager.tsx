import React, { useEffect, useRef, useState } from 'react';
import { Edit3, LayoutGrid, Plus, Store, Trash2, X } from 'lucide-react';
import { BundleOffer, EntitlementItem, OfferDisplayEntry, OfferDisplayGroup } from '../types/entitlement';
import { sanitizeVerseIdentifier, toPascalCase, validateOfferDisplayGroup } from '../services/validator';
import { draftVerseKeyForName } from '../services/verseIdentity';
import { storefrontEditableName } from '../services/editableBindings';
import { ConfirmDialog } from './ConfirmDialog';

interface OfferDisplayManagerProps {
  groups: OfferDisplayGroup[];
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  allocateVerseKey: (name: string) => string;
  onChange: (groups: OfferDisplayGroup[]) => void;
}

const emptyGroup = (groups: OfferDisplayGroup[], allocateVerseKey: (name: string) => string): OfferDisplayGroup => {
  const ordinal = groups.length + 1;
  const name = ordinal === 1 ? 'Coin Store' : `Offer Store ${ordinal}`;
  const verseKey = allocateVerseKey(name);
  return ({
  id: `store-${crypto.randomUUID()}`,
  verseKey,
  name,
  entries: [],
  generateTriggerBinding: true,
  });
};

const entryKey = (entry: OfferDisplayEntry) => entry.bundleId
  ? `bundle:${entry.bundleId}`
  : `entitlement:${entry.entitlementId}:${entry.offerVerseKey ?? ''}`;

export const OfferDisplayManager: React.FC<OfferDisplayManagerProps> = ({ groups, entitlements, bundles, allocateVerseKey, onChange }) => {
  const [editing, setEditing] = useState<OfferDisplayGroup | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OfferDisplayGroup | null>(null);
  return (
    <section className="space-y-3" aria-labelledby="offer-display-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="offer-display-heading" className="flex items-center gap-2 text-sm font-bold text-white"><Store className="h-4 w-4 text-cyan-400" /> Offer displays</h2>
          <p className="text-xs text-slate-400">Create focused storefronts such as a Coin Store or Upgrade Shop. Each display shows selected offers together; it does not sell them as one bundle.</p>
        </div>
        <button type="button" onClick={() => setEditing(emptyGroup(groups, allocateVerseKey))} className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold hover:bg-slate-700"><Plus className="h-3.5 w-3.5" /> Add offer display</button>
      </div>
      {groups.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-500">No focused storefronts configured. The generated <code>OpenAllOffersStore(Player)</code> function still shows every offer.</div> : <div className="grid gap-3 md:grid-cols-2">{groups.map(group => <article key={group.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-[#0f1629]/70 p-4"><div><h3 className="text-sm font-bold text-white">{group.name}</h3><p className="mt-0.5 font-mono text-[11px] text-cyan-300">Open{toPascalCase(group.verseKey)}(Player)</p><p className="mt-1 text-xs text-slate-400">{group.entries.length} selected offer{group.entries.length === 1 ? '' : 's'}{group.generateTriggerBinding ? ` · ${storefrontEditableName(group.verseKey)}` : ''}</p></div><div className="flex gap-1"><button type="button" aria-label={`Edit ${group.name}`} onClick={() => setEditing(group)} className="p-2 text-slate-400 hover:text-cyan-300"><Edit3 className="h-4 w-4" /></button><button type="button" aria-label={`Delete ${group.name}`} onClick={() => setPendingDelete(group)} className="p-2 text-slate-400 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div></article>)}</div>}
      <OfferDisplayEditor group={editing} groups={groups} entitlements={entitlements} bundles={bundles} onClose={() => setEditing(null)} onSave={group => { onChange(groups.some(candidate => candidate.id === group.id) ? groups.map(candidate => candidate.id === group.id ? group : candidate) : [...groups, group]); setEditing(null); }} />
      <ConfirmDialog open={Boolean(pendingDelete)} title={`Delete ${pendingDelete?.name ?? 'offer display'}?`} description={<>This removes only the focused storefront definition. Its individual offers and bundles stay in the catalog, and the project file remains unchanged until you save.</>} confirmLabel="Delete offer display" onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) onChange(groups.filter(candidate => candidate.id !== pendingDelete.id)); setPendingDelete(null); }} />
    </section>
  );
};

const OfferDisplayEditor: React.FC<{
  group: OfferDisplayGroup | null;
  groups: OfferDisplayGroup[];
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  onClose: () => void;
  onSave: (group: OfferDisplayGroup) => void;
}> = ({ group, groups, entitlements, bundles, onClose, onSave }) => {
  const [form, setForm] = useState<OfferDisplayGroup | null>(group);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => setForm(group), [group]);
  useEffect(() => {
    if (!group) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [group, onClose]);
  if (!form) return null;
  const errors = validateOfferDisplayGroup(form, entitlements, bundles, groups).filter(issue => issue.severity === 'error');
  const options: Array<{ key: string; label: string; detail: string; entry: OfferDisplayEntry }> = [];
  for (const item of entitlements) {
    options.push({ key: `entitlement:${item.id}:`, label: item.name, detail: `${item.verseKey}_offer`, entry: { entitlementId: item.id } });
    for (const offer of item.alternateOffers ?? []) options.push({ key: `entitlement:${item.id}:${offer.verseKey}`, label: `${item.name} · ${offer.name}`, detail: `${offer.verseKey}_offer`, entry: { entitlementId: item.id, offerVerseKey: offer.verseKey } });
  }
  for (const bundle of bundles) options.push({ key: `bundle:${bundle.id}`, label: bundle.name, detail: `${bundle.verseKey}_offer · bundle`, entry: { bundleId: bundle.id } });
  const selected = new Set(form.entries.map(entryKey));
  const toggleEntry = (option: typeof options[number]) => setForm(previous => previous && ({ ...previous, entries: selected.has(option.key) ? previous.entries.filter(entry => entryKey(entry) !== option.key) : [...previous.entries, option.entry] }));
  const updateKeyFromName = (name: string) => setForm(previous => {
    if (!previous) return previous;
    const isExisting = groups.some(candidate => candidate.id === previous.id);
    const nextKey = draftVerseKeyForName(previous.verseKey, previous.name, name, isExisting);
    return { ...previous, name, verseKey: nextKey };
  });

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="offer-display-dialog-title" tabIndex={-1} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700 bg-[#0d1326] p-6 shadow-2xl outline-none">
    <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-cyan-300">Focused storefront</p><h2 id="offer-display-dialog-title" className="mt-1 font-bold text-white">{groups.some(candidate => candidate.id === form.id) ? 'Edit offer display' : 'Create offer display'}</h2></div><button type="button" aria-label="Close offer display editor" onClick={onClose} className="p-2 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button></div>
    <form onSubmit={event => { event.preventDefault(); if (!errors.length) onSave(form); }} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-300">Storefront title<input value={form.name} maxLength={50} onChange={event => updateKeyFromName(event.target.value)} placeholder="Coin Store" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label><label className="text-xs text-slate-300">Verse key<input value={form.verseKey} onChange={event => setForm({ ...form, verseKey: sanitizeVerseIdentifier(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-cyan-300" /></label></div>
      <fieldset className="space-y-2"><legend className="flex items-center gap-2 text-xs font-bold text-slate-200"><LayoutGrid className="h-4 w-4 text-cyan-300" /> Offers shown in this storefront</legend><p className="text-[11px] text-slate-500">Players purchase each selected offer individually. Select a bundle only when that bundle itself should appear as one purchasable card.</p><div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/40 p-2">{options.map(option => <label key={option.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-900"><input type="checkbox" checked={selected.has(option.key)} onChange={() => toggleEntry(option)} className="accent-cyan-500" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white">{option.label}</span><span className="block truncate font-mono text-[10px] text-slate-500">{option.detail}</span></span></label>)}</div></fieldset>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><label className="flex items-center justify-between gap-3 text-xs text-slate-300"><span><strong className="block text-white">Generate Open Trigger device array</strong><span className="text-[11px] text-slate-500">Assign one or more Trigger devices to open this storefront without writing Verse.</span></span><input type="checkbox" checked={form.generateTriggerBinding} onChange={event => setForm({ ...form, generateTriggerBinding: event.target.checked })} className="accent-cyan-500" /></label>{form.generateTriggerBinding && <p className="mt-2 text-[11px] text-slate-500">Generated editable: <code className="text-cyan-300">{storefrontEditableName(form.verseKey)}</code></p>}</div>
      {errors.length > 0 && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{errors.map(error => <p key={error.id}>{error.message}</p>)}</div>}
      <div className="flex justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button><button type="submit" disabled={errors.length > 0} className="rounded-xl bg-cyan-400 px-4 py-2 text-xs font-extrabold text-slate-950 disabled:opacity-40">Save offer display</button></div>
    </form>
  </div></div>;
};
