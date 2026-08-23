import React, { useEffect, useRef, useState } from 'react';
import { Boxes, Copy, Plus, Trash2, X } from 'lucide-react';
import { BundleOffer, EntitlementItem } from '../types/entitlement';
import { validateBundleOffer } from '../services/validator';
import { OfferRestrictionsEditor } from './OfferRestrictionsEditor';
import { PLACEHOLDER_ICON_ASSET_NAME } from '../constants/placeholderIcon';
import { MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';
import { ConfirmDialog } from './ConfirmDialog';
import { VBucksIcon } from './VBucksIcon';
import { DraftConfirmDialog } from './DraftConfirmDialog';
import { useModalFocus } from '../hooks/useModalFocus';
import { bundleDraftSnapshot } from '../services/draftSnapshots';
import { NumericInput } from './NumericInput';
import { bundleQuantityBehavior } from '../services/dynamicOffers';

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
            <article key={bundle.id} className="rounded-2xl border border-slate-800 bg-[#0f1629]/70 p-4 transition hover:border-cyan-500/40 hover:bg-[#15203b]">
              <div role="button" tabIndex={0} aria-label={`Edit ${bundle.name}`} onClick={() => setEditing(bundle)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditing(bundle); } }} className="cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
                <h3 className="font-bold text-sm text-white">{bundle.name}</h3><p className="text-[11px] text-cyan-300 font-mono">{bundle.verseKey}_offer</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-400" aria-label={`${bundle.priceVBucks.toLocaleString()} V-Bucks`}>{bundle.items.length} entries <span aria-hidden="true">·</span> <VBucksIcon className="h-3.5 w-3.5 text-sky-400" /> <span>{bundle.priceVBucks.toLocaleString()}</span></p>
              </div>
              <div className="flex gap-1">
                <button type="button" aria-label={`Duplicate ${bundle.name}`} onClick={() => onDuplicate(bundle)} className="p-2 text-slate-400 hover:text-slate-200"><Copy className="w-4 h-4" /></button>
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
        description={<>This removes the bundle and any references to it from storefronts. The project file remains unchanged until you save.</>}
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
  const initialFormRef = useRef<BundleOffer | null>(bundle);
  const [dirtyConfirmationOpen, setDirtyConfirmationOpen] = useState(false);
  useEffect(() => {
    setForm(bundle);
    initialFormRef.current = bundle;
    setDirtyConfirmationOpen(false);
  }, [bundle]);
  const isDirty = Boolean(form && initialFormRef.current && bundleDraftSnapshot(form) !== bundleDraftSnapshot(initialFormRef.current));
  const requestClose = () => { if (isDirty) setDirtyConfirmationOpen(true); else onClose(); };
  useModalFocus({ open: Boolean(bundle), dialogRef, onEscape: requestClose, paused: dirtyConfirmationOpen });
  if (!form) return null;
  const errors = validateBundleOffer(form, entitlements, bundles).filter(item => item.severity === 'error');
  const isExisting = bundles.some(candidate => candidate.id === form.id);
  const commitForm = () => { if (!errors.length) onSave(form); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onMouseDown={event => { if (event.currentTarget === event.target) requestClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="bundle-dialog-title" tabIndex={-1} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-700 bg-[#0d1326] p-6 shadow-2xl outline-none">
        <div className="flex items-center justify-between mb-5"><h2 id="bundle-dialog-title" className="font-bold text-white">{isExisting ? 'Edit bundle offer' : 'Create bundle offer'}</h2><button type="button" aria-label="Close bundle editor" onClick={requestClose} className="p-2 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button></div>
        <form onSubmit={event => { event.preventDefault(); commitForm(); }} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-300">Display name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300 sm:col-span-2">Short description (up to {MARKETPLACE_CONSTRAINTS.shortDescriptionMaxCharacters} characters)<input value={form.shortDescription} onChange={e => setForm({ ...form, shortDescription: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300 sm:col-span-2">Description (up to {MARKETPLACE_CONSTRAINTS.descriptionMaxCharacters} characters before generated disclosures)<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300">Price in V-Bucks<span className="mt-1 flex items-center gap-2"><VBucksIcon className="h-4 w-4 text-sky-400" /><NumericInput ariaLabel="Bundle price in V-Bucks" min={MARKETPLACE_CONSTRAINTS.priceMinVBucks} max={MARKETPLACE_CONSTRAINTS.priceMaxVBucks} step={MARKETPLACE_CONSTRAINTS.priceStepVBucks} value={form.priceVBucks} onChange={value => setForm({ ...form, priceVBucks: value })} className="w-16" /></span></label>
            <label className="text-xs text-slate-300">Texture expression<input value={form.iconTexture} onChange={e => setForm({ ...form, iconTexture: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono" /></label>
            <label className="text-xs text-slate-300 sm:col-span-2">Duration disclosure<input value={form.durationDescription ?? ''} onChange={e => setForm({ ...form, durationDescription: e.target.value })} placeholder="e.g. Lasts 7 days after purchase" className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" /></label>
            <div className="sm:col-span-2"><OfferRestrictionsEditor compact restrictions={{ blockedCountryCodes: [], blockedPlatformFamilies: [], ...form.restrictions }} onChange={restrictions => setForm({ ...form, restrictions })} /></div>
          </div>
          <fieldset className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 space-y-3"><legend className="px-1 text-xs font-extrabold text-cyan-200">Price source</legend><label className="flex items-center justify-between gap-3 text-xs text-slate-300"><span><span className="block font-bold text-white">How is this price set?</span><span className="text-slate-400">Choose a fixed catalog price or let your project supply it at purchase time.</span></span><select aria-label="Bundle price behavior" value={form.dynamicOffer?.priceBehavior ?? 'fixed'} onChange={e => setForm({ ...form, dynamicOffer: e.target.value === 'runtime' ? { priceBehavior: 'runtime' } : undefined })} className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs"><option value="fixed">Fixed price</option><option value="runtime">Set by Verse at runtime</option></select></label><p className="text-[11px] leading-5 text-slate-400">For runtime pricing, project Verse supplies the player-specific price when the purchase opens. Runtime bundles are direct-purchase only.</p></fieldset>
          <fieldset className="space-y-2"><legend className="text-xs font-bold text-slate-300">Included entitlements</legend>{entitlements.map(item => {
            const entry = form.items.find(candidate => candidate.entitlementId === item.id);
            const behavior = entry ? bundleQuantityBehavior(form, entry) : 'fixed';
            return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-3"><label className="text-xs text-white"><input type="checkbox" checked={Boolean(entry)} onChange={e => setForm({ ...form, items: e.target.checked ? [...form.items.filter(candidate => candidate.entitlementId !== item.id), { entitlementId: item.id, quantity: 1 }] : form.items.filter(candidate => candidate.entitlementId !== item.id) })} className="mr-2" />{item.name}</label>{entry && <div className="flex flex-wrap items-center justify-end gap-2"><select aria-label={`${item.name} offer variant`} value={entry.offerVerseKey ?? ''} onChange={e => setForm({ ...form, items: form.items.map(candidate => candidate.entitlementId === item.id ? { ...candidate, offerVerseKey: e.target.value || undefined } : candidate) })} className="w-32 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"><option value="">Default offer</option>{(item.alternateOffers ?? []).map(offer => <option key={offer.id} value={offer.verseKey}>{offer.name}</option>)}</select><select aria-label={`${item.name} quantity behavior`} value={behavior} onChange={e => setForm({ ...form, items: form.items.map(candidate => candidate.entitlementId === item.id ? { ...candidate, quantityBehavior: e.target.value === 'fixed' ? undefined : e.target.value as 'fill-to-max' | 'runtime', quantity: 1 } : candidate) })} className="w-44 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"><option value="fixed">Fixed quantity</option><option value="fill-to-max">Fill to player maximum</option><option value="runtime">Set by Verse at runtime</option></select>{behavior === 'fixed' && <NumericInput ariaLabel={`${item.name} quantity`} min={1} max={item.maxCount} value={entry.quantity} onChange={value => setForm({ ...form, items: form.items.map(candidate => candidate.entitlementId === item.id ? { ...candidate, quantity: value } : candidate) })} className="w-14 text-xs" />}</div>}</div>;
          })}</fieldset>
          <fieldset className="space-y-2"><legend className="text-xs font-bold text-slate-300">Nested bundles</legend>{bundles.filter(candidate => candidate.id !== form.id).map(candidate => {
            const entry = form.items.find(item => item.bundleId === candidate.id);
            return <div key={candidate.id} className="flex items-center justify-between rounded-xl bg-slate-900 p-3"><label className="text-xs text-white"><input type="checkbox" checked={Boolean(entry)} onChange={e => setForm({ ...form, items: e.target.checked ? [...form.items.filter(item => item.bundleId !== candidate.id), { bundleId: candidate.id, quantity: 1 }] : form.items.filter(item => item.bundleId !== candidate.id) })} className="mr-2" />{candidate.name}</label>{entry && <NumericInput ariaLabel={`${candidate.name} quantity`} min={1} value={entry.quantity} onChange={value => setForm({ ...form, items: form.items.map(item => item.bundleId === candidate.id ? { ...item, quantity: value } : item) })} className="w-14 text-xs" />}</div>;
          })}</fieldset>
          {errors.length > 0 && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{errors.map(error => <p key={error.id}>{error.message}</p>)}</div>}
           <div className="flex justify-end gap-2"><button type="button" onClick={requestClose} className="px-4 py-2 text-xs">Cancel</button><button type="submit" disabled={errors.length > 0} className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 text-slate-950 disabled:opacity-50">Save bundle</button></div>
        </form>
      </div>
      <DraftConfirmDialog open={dirtyConfirmationOpen} isNew={!isExisting} subject="bundle offer" onSave={() => { setDirtyConfirmationOpen(false); commitForm(); }} onDiscard={() => { setDirtyConfirmationOpen(false); onClose(); }} onContinue={() => setDirtyConfirmationOpen(false)} />
    </div>
  );
};
