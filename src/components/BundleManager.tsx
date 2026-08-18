import React, { useEffect, useRef, useState } from 'react';
import { Boxes, Copy, Edit3, Plus, Trash2, X } from 'lucide-react';
import { BundleOffer, EntitlementItem } from '../types/entitlement';
import { sanitizeVerseIdentifier, validateBundleOffer } from '../services/validator';
import { draftVerseKeyForName } from '../services/verseIdentity';
import { OfferRestrictionsEditor } from './OfferRestrictionsEditor';
import { PLACEHOLDER_ICON_ASSET_NAME } from '../constants/placeholderIcon';
import { MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';
import { ConfirmDialog } from './ConfirmDialog';
import { VBucksIcon } from './VBucksIcon';

interface BundleManagerProps {
  bundles: BundleOffer[];
  entitlements: EntitlementItem[];
  assetFolderName: string;
  allocateVerseKey: (name: string) => string;
  onChange: (bundles: BundleOffer[]) => void;
  onDuplicate: (bundle: BundleOffer) => void;
}

const emptyBundle = (assetFolder: string, verseKey: string): BundleOffer => ({
  id: `bundle-${crypto.randomUUID()}`,
  verseKey,
  name: 'Starter Bundle',
  shortDescription: 'A collection of island entitlements.',
  description: 'Purchase multiple entitlements together in one offer.',
  priceVBucks: 500,
  iconTexture: `${assetFolder}.${PLACEHOLDER_ICON_ASSET_NAME}`,
  durationDescription: '',
  restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  dynamicRemaining: false,
  items: [],
});

export const BundleManager: React.FC<BundleManagerProps> = ({ bundles, entitlements, assetFolderName, allocateVerseKey, onChange, onDuplicate }) => {
  const [editing, setEditing] = useState<BundleOffer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BundleOffer | null>(null);

  return (
    <section className="space-y-3" aria-labelledby="bundle-heading">
      <div className="flex items-center justify-between">
        <div>
          <h2 id="bundle-heading" className="text-sm font-bold text-white flex items-center gap-2"><Boxes className="w-4 h-4 text-cyan-400" /> Bundle offers</h2>
          <p className="text-xs text-slate-400">Bundles reference one or more offers, preserve exact quantities, and support nested offers up to five levels.</p>
        </div>
        <button type="button" onClick={() => setEditing(emptyBundle(assetFolderName, allocateVerseKey('Starter Bundle')))} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700">
          <Plus className="w-3.5 h-3.5" /> Add bundle
        </button>
      </div>
      {bundles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-500">No bundle offers configured.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {bundles.map(bundle => (
            <article key={bundle.id} className="rounded-2xl border border-slate-800 bg-[#0f1629]/70 p-4 flex items-start justify-between gap-3">
              <div><h3 className="font-bold text-sm text-white">{bundle.name}</h3><p className="text-[11px] text-cyan-300 font-mono">{bundle.verseKey}_offer</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-400">{bundle.items.length} entries <span aria-hidden="true">·</span> <VBucksIcon className="h-3.5 w-3.5 text-sky-400" /> <span>{bundle.priceVBucks.toLocaleString()} V-Bucks</span></p></div>
              <div className="flex gap-1">
                <button type="button" aria-label={`Duplicate ${bundle.name}`} onClick={() => onDuplicate(bundle)} className="p-2 text-slate-400 hover:text-slate-200"><Copy className="w-4 h-4" /></button>
                <button type="button" aria-label={`Edit ${bundle.name}`} onClick={() => setEditing(bundle)} className="p-2 text-slate-400 hover:text-cyan-300"><Edit3 className="w-4 h-4" /></button>
                <button type="button" aria-label={`Delete ${bundle.name}`} onClick={() => setPendingDelete(bundle)} className="p-2 text-slate-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      <BundleEditorModal
        bundle={editing}
        bundles={bundles}
        entitlements={entitlements}
        onClose={() => setEditing(null)}
        onSave={bundle => {
          onChange(bundles.some(existing => existing.id === bundle.id) ? bundles.map(existing => existing.id === bundle.id ? bundle : existing) : [...bundles, bundle]);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? 'bundle'}?`}
        description={<>This removes the bundle and any references to it from focused storefronts. The project file remains unchanged until you save.</>}
        confirmLabel="Delete bundle"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) onChange(bundles.filter(candidate => candidate.id !== pendingDelete.id)); setPendingDelete(null); }}
      />
    </section>
  );
};

const BundleEditorModal: React.FC<{
  bundle: BundleOffer | null;
  bundles: BundleOffer[];
  entitlements: EntitlementItem[];
  onClose: () => void;
  onSave: (bundle: BundleOffer) => void;
}> = ({ bundle, bundles, entitlements, onClose, onSave }) => {
  const [form, setForm] = useState<BundleOffer | null>(bundle);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => setForm(bundle), [bundle]);
  useEffect(() => {
    if (!bundle) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex]:not([tabindex="-1"])')).filter(element => !element.hasAttribute('disabled'));
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [bundle, onClose]);
  if (!form) return null;
  const errors = validateBundleOffer(form, entitlements, bundles).filter(item => item.severity === 'error');
  const isExisting = bundles.some(candidate => candidate.id === form.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="bundle-dialog-title" tabIndex={-1} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-700 bg-[#0d1326] p-6 shadow-2xl outline-none">
        <div className="flex items-center justify-between mb-5"><h2 id="bundle-dialog-title" className="font-bold text-white">{isExisting ? 'Edit bundle offer' : 'Create bundle offer'}</h2><button type="button" aria-label="Close bundle editor" onClick={onClose} className="p-2 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button></div>
        <form onSubmit={event => { event.preventDefault(); if (!errors.length) onSave(form); }} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-300">Display name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value, verseKey: draftVerseKeyForName(form.verseKey, form.name, e.target.value, isExisting) })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300">Verse key<input value={form.verseKey} onChange={e => setForm({ ...form, verseKey: sanitizeVerseIdentifier(e.target.value) })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono" /></label>
            <label className="text-xs text-slate-300 sm:col-span-2">Short description (up to {MARKETPLACE_CONSTRAINTS.shortDescriptionMaxCharacters} characters)<input value={form.shortDescription} onChange={e => setForm({ ...form, shortDescription: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300 sm:col-span-2">Description (up to {MARKETPLACE_CONSTRAINTS.descriptionMaxCharacters} characters before generated disclosures)<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300">Price in V-Bucks<span className="mt-1 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3"><VBucksIcon className="h-4 w-4 text-sky-400" /><input aria-label="Bundle price in V-Bucks" type="number" min={MARKETPLACE_CONSTRAINTS.priceMinVBucks} max={MARKETPLACE_CONSTRAINTS.priceMaxVBucks} step={MARKETPLACE_CONSTRAINTS.priceStepVBucks} value={form.priceVBucks} onChange={e => setForm({ ...form, priceVBucks: Number(e.target.value) })} className="min-w-0 flex-1 bg-transparent py-2 outline-none" /></span></label>
            <label className="text-xs text-slate-300">Texture expression<input value={form.iconTexture} onChange={e => setForm({ ...form, iconTexture: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono" /></label>
            <label className="text-xs text-slate-300 sm:col-span-2">Duration disclosure<input value={form.durationDescription ?? ''} onChange={e => setForm({ ...form, durationDescription: e.target.value })} placeholder="e.g. Lasts 7 days after purchase" className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <div className="sm:col-span-2"><OfferRestrictionsEditor compact restrictions={{ blockedCountryCodes: [], blockedPlatformFamilies: [], ...form.restrictions }} onChange={restrictions => setForm({ ...form, restrictions })} /></div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><input type="checkbox" checked={Boolean(form.dynamicRemaining)} onChange={e => setForm({ ...form, dynamicRemaining: e.target.checked })} />Dynamic remaining-quantity bundle (exactly one entitlement at quantity 1; max count is reduced by owned quantity)<span className="text-amber-300">Direct purchase only; nested and multi-item dynamic bundles are unsupported.</span></label>
          <fieldset className="space-y-2"><legend className="text-xs font-bold text-slate-300">Included entitlements</legend>{entitlements.map(item => {
            const entry = form.items.find(candidate => candidate.entitlementId === item.id);
            return <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 p-3"><label className="text-xs text-white"><input type="checkbox" checked={Boolean(entry)} onChange={e => setForm({ ...form, items: e.target.checked ? [...form.items.filter(candidate => candidate.entitlementId !== item.id), { entitlementId: item.id, quantity: 1 }] : form.items.filter(candidate => candidate.entitlementId !== item.id) })} className="mr-2" />{item.name}</label>{entry && <div className="flex items-center gap-2"><select aria-label={`${item.name} offer variant`} value={entry.offerVerseKey ?? ''} onChange={e => setForm({ ...form, items: form.items.map(candidate => candidate.entitlementId === item.id ? { ...candidate, offerVerseKey: e.target.value || undefined } : candidate) })} className="w-32 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"><option value="">Default offer</option>{(item.alternateOffers ?? []).map(offer => <option key={offer.id} value={offer.verseKey}>{offer.name}</option>)}</select><input aria-label={`${item.name} quantity`} type="number" min={1} max={item.maxCount} value={entry.quantity} onChange={e => setForm({ ...form, items: form.items.map(candidate => candidate.entitlementId === item.id ? { ...candidate, quantity: Number(e.target.value) } : candidate) })} className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs" /></div>}</div>;
          })}</fieldset>
          <fieldset className="space-y-2"><legend className="text-xs font-bold text-slate-300">Nested bundles</legend>{bundles.filter(candidate => candidate.id !== form.id).map(candidate => {
            const entry = form.items.find(item => item.bundleId === candidate.id);
            return <div key={candidate.id} className="flex items-center justify-between rounded-xl bg-slate-900 p-3"><label className="text-xs text-white"><input type="checkbox" checked={Boolean(entry)} onChange={e => setForm({ ...form, items: e.target.checked ? [...form.items.filter(item => item.bundleId !== candidate.id), { bundleId: candidate.id, quantity: 1 }] : form.items.filter(item => item.bundleId !== candidate.id) })} className="mr-2" />{candidate.name}</label>{entry && <input aria-label={`${candidate.name} quantity`} type="number" min={1} value={entry.quantity} onChange={e => setForm({ ...form, items: form.items.map(item => item.bundleId === candidate.id ? { ...item, quantity: Number(e.target.value) } : item) })} className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs" />}</div>;
          })}</fieldset>
          {errors.length > 0 && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{errors.map(error => <p key={error.id}>{error.message}</p>)}</div>}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-xs">Cancel</button><button type="submit" disabled={errors.length > 0} className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 text-slate-950 disabled:opacity-50">Save bundle</button></div>
        </form>
      </div>
    </div>
  );
};
