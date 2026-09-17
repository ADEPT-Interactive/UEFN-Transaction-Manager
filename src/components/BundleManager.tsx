import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Boxes, Copy, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import { BundleOffer, BundleOfferItem, EntitlementItem, ValidationIssue } from '../types/entitlement';
import { validateBundleOffer } from '../services/validator';
import { OfferRestrictionsEditor } from './OfferRestrictionsEditor';
import { PLACEHOLDER_ICON_ASSET_NAME, PLACEHOLDER_ICON_DATA_URL, isPlaceholderIconTexture } from '../constants/placeholderIcon';
import { MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';
import { ConfirmDialog } from './ConfirmDialog';
import { VBucksIcon } from './VBucksIcon';
import { DraftConfirmDialog } from './DraftConfirmDialog';
import { useModalFocus } from '../hooks/useModalFocus';
import { bundleDraftSnapshot } from '../services/draftSnapshots';
import { NumericInput } from './NumericInput';
import { VBucksPriceControl } from './VBucksPriceControl';
import { bundleQuantityBehavior, getBundleBehavior } from '../services/dynamicOffers';
import { EditorStatus } from '../services/fileService';
import { ConfirmedTextureImport, ImageUploadZone, ImageUploadZoneHandle } from './ImageUploadZone';
import { PlaceholderIcon } from './PlaceholderIcon';

interface BundleManagerProps {
  bundles: BundleOffer[];
  entitlements: EntitlementItem[];
  assetFolderName: string;
  contentFolderPath: string;
  editorStatus: EditorStatus | null;
  warningCounts?: Record<string, number>;
  dismissedWarningIds?: string[];
  allocateVerseKey: (name: string) => string;
  onChange: (bundles: BundleOffer[]) => void;
  onDuplicate: (bundle: BundleOffer) => void | Promise<void>;
}

const emptyBundle = (assetFolder: string, verseKey: string): BundleOffer => ({
  id: 'bundle-' + crypto.randomUUID(),
  verseKey,
  name: 'Starter Bundle',
  shortDescription: 'A collection of island entitlements.',
  description: 'Purchase multiple entitlements together in one offer.',
  priceVBucks: 500,
  iconTexture: assetFolder + '.' + PLACEHOLDER_ICON_ASSET_NAME,
  iconImageData: PLACEHOLDER_ICON_DATA_URL,
  durationDescription: '',
  restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  items: [],
});

const InlineWarnings: React.FC<{ issues: ValidationIssue[] }> = ({ issues }) => issues.length === 0 ? null : (
  <div className="mt-1 space-y-1 text-[11px] leading-4 text-amber-300" role="status">
    {issues.map(issue => <p key={issue.id}>{issue.message}</p>)}
  </div>
);

const iconIsPlaceholder = (texture: string | undefined): boolean => !texture || isPlaceholderIconTexture(texture);

const OfferIcon: React.FC<{
  texture?: string;
  imageData?: string;
  className?: string;
  alt?: string;
}> = ({ texture, imageData, className = 'h-9 w-9', alt = '' }) => {
  if (!iconIsPlaceholder(texture) && imageData) {
    return <img src={imageData} alt={alt} className={'rounded-lg border border-slate-700 object-cover ' + className} />;
  }
  return <PlaceholderIcon className={'rounded-lg border border-slate-700 ' + className} alt={alt} />;
};

function resolveBundleEntry(
  entry: BundleOfferItem,
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
): { name: string; texture?: string; imageData?: string; quantity: number } | undefined {
  if (entry.entitlementId) {
    const entitlement = entitlements.find(item => item.id === entry.entitlementId);
    if (!entitlement) return undefined;
    const alternate = entry.offerVerseKey
      ? (entitlement.alternateOffers ?? []).find(offer =>
        offer.verseKey.toLowerCase() === entry.offerVerseKey!.toLowerCase()
        || offer.id.toLowerCase() === entry.offerVerseKey!.toLowerCase(),
      )
      : undefined;
    return {
      name: alternate?.name ?? entitlement.name,
      texture: alternate?.iconTexture ?? entitlement.iconTexture,
      imageData: alternate?.iconImageData ?? entitlement.iconImageData,
      quantity: entry.quantity,
    };
  }
  if (entry.bundleId) {
    const nested = bundles.find(candidate => candidate.id === entry.bundleId);
    if (!nested) return undefined;
    return { name: nested.name, texture: nested.iconTexture, imageData: nested.iconImageData, quantity: entry.quantity };
  }
  return undefined;
}

export const BundleManager: React.FC<BundleManagerProps> = ({
  bundles,
  entitlements,
  assetFolderName,
  contentFolderPath,
  editorStatus,
  warningCounts = {},
  dismissedWarningIds = [],
  allocateVerseKey,
  onChange,
  onDuplicate,
}) => {
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
          {bundles.map(bundle => {
            const warningCount = warningCounts[bundle.id] ?? 0;
            const behavior = getBundleBehavior(bundle);
            return (
              <article key={bundle.id} className="rounded-2xl border border-slate-800 bg-[#0f1629]/70 p-4 transition hover:border-cyan-500/40 hover:bg-[#15203b]">
                <div role="button" tabIndex={0} aria-label={'Edit ' + bundle.name} onClick={() => setEditing(bundle)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditing(bundle); } }} className="cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
                  <div className="flex items-start gap-3">
                    <OfferIcon texture={bundle.iconTexture} imageData={bundle.iconImageData} className="h-12 w-12 shrink-0" alt="" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-sm text-white">{bundle.name}</h3>
                      <p className="text-[11px] text-cyan-300 font-mono">{bundle.verseKey}_offer</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-400" aria-label={bundle.priceVBucks.toLocaleString() + ' V-Bucks'}>
                        {bundle.items.length} entr{bundle.items.length === 1 ? 'y' : 'ies'} <span aria-hidden="true">·</span> <VBucksIcon className="h-3.5 w-3.5 text-sky-400" /> <span>{bundle.priceVBucks.toLocaleString()}</span>
                      </p>
                    </div>
                  </div>
                  {warningCount > 0 && <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-200" role="status"><ShieldAlert className="h-3 w-3" /> {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}</div>}
                  {behavior.mode === 'invalid' && <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-rose-300"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Invalid quantity mode</p>}
                  {bundle.items.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3" aria-label="Bundle contents preview">
                      {bundle.items.slice(0, 4).map((entry, index) => {
                        const resolved = resolveBundleEntry(entry, entitlements, bundles);
                        if (!resolved) return <p key={index} className="text-[11px] text-rose-300">Missing entry</p>;
                        return <div key={index} className="flex items-center gap-2 text-[11px] text-slate-300"><OfferIcon texture={resolved.texture} imageData={resolved.imageData} className="h-6 w-6 shrink-0" alt="" /><span className="min-w-0 flex-1 truncate">{resolved.name}</span><span className="font-mono text-slate-500">×{resolved.quantity}</span></div>;
                      })}
                      {bundle.items.length > 4 && <p className="text-[10px] text-slate-500">+{bundle.items.length - 4} more</p>}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex justify-end gap-1">
                  <button type="button" aria-label={'Duplicate ' + bundle.name} onClick={() => onDuplicate(bundle)} className="p-2 text-slate-400 hover:text-slate-200"><Copy className="w-4 h-4" /></button>
                  <button type="button" aria-label={'Delete ' + bundle.name} onClick={() => setPendingDelete(bundle)} className="p-2 text-slate-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <BundleEditorModal
        bundle={editing}
        bundles={bundles}
        entitlements={entitlements}
        contentFolderPath={contentFolderPath}
        assetFolderName={assetFolderName}
        editorStatus={editorStatus}
        dismissedWarningIds={dismissedWarningIds}
        onClose={() => setEditing(null)}
        onSave={bundle => {
          onChange(bundles.some(existing => existing.id === bundle.id) ? bundles.map(existing => existing.id === bundle.id ? bundle : existing) : [...bundles, bundle]);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={'Delete ' + (pendingDelete?.name ?? 'bundle') + '?'}
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
  contentFolderPath: string;
  assetFolderName: string;
  editorStatus: EditorStatus | null;
  dismissedWarningIds: string[];
  onClose: () => void;
  onSave: (bundle: BundleOffer) => void;
}> = ({
  bundle,
  bundles,
  entitlements,
  contentFolderPath,
  assetFolderName,
  editorStatus,
  dismissedWarningIds,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<BundleOffer | null>(bundle);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingIconDialogRef = useRef<HTMLDivElement>(null);
  const pendingIconCancelRef = useRef<HTMLButtonElement>(null);
  const imageUploadRef = useRef<ImageUploadZoneHandle>(null);
  const initialFormRef = useRef<BundleOffer | null>(bundle);
  const [pendingIconUpload, setPendingIconUpload] = useState(false);
  const [pendingAction, setPendingAction] = useState<'save' | null>(null);
  const [dirtyConfirmationOpen, setDirtyConfirmationOpen] = useState(false);
  const [modeConfirmation, setModeConfirmation] = useState<'fill-to-max' | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);

  useEffect(() => {
    setForm(bundle);
    initialFormRef.current = bundle;
    setPendingIconUpload(false);
    setPendingAction(null);
    setDirtyConfirmationOpen(false);
    setModeConfirmation(null);
    setModeError(null);
  }, [bundle]);

  const isDirty = Boolean(form && initialFormRef.current && bundleDraftSnapshot(form) !== bundleDraftSnapshot(initialFormRef.current));
  const requestClose = () => {
    if (isDirty || pendingIconUpload) setDirtyConfirmationOpen(true);
    else onClose();
  };

  const confirmPendingIcon = async () => {
    if (!pendingAction || !form) return;
    const confirmed: ConfirmedTextureImport | null = await imageUploadRef.current?.confirmPendingImport() ?? null;
    if (!confirmed) return;
    const nextBundle = { ...form, iconTexture: confirmed.verseAssetPath, iconImageData: confirmed.preview };
    setForm(nextBundle);
    setPendingAction(null);
    onSave(nextBundle);
  };

  useModalFocus({ open: Boolean(bundle), dialogRef, onEscape: requestClose, paused: dirtyConfirmationOpen || Boolean(pendingAction) || Boolean(modeConfirmation) });
  useModalFocus({ open: Boolean(pendingAction), dialogRef: pendingIconDialogRef, onEscape: () => setPendingAction(null), initialFocusRef: pendingIconCancelRef });

  if (!form) return null;

  const isExisting = bundles.some(candidate => candidate.id === form.id);
  const validationIssues = validateBundleOffer(form, entitlements, bundles);
  const visibleValidationIssues = validationIssues.filter(issue => issue.severity !== 'warning' || !dismissedWarningIds.includes(issue.id));
  const errors = visibleValidationIssues.filter(item => item.severity === 'error');
  const warningsFor = (field: string) => visibleValidationIssues.filter(issue => issue.severity === 'warning' && issue.field === field);
  const fieldClass = (base: string, field: string) => warningsFor(field).length > 0 ? base + ' border-amber-400/70' : base;
  const quantityMode = form.items.some(entry => bundleQuantityBehavior(form, entry) === 'fill-to-max')
    ? 'fill-to-max'
    : form.items.some(entry => bundleQuantityBehavior(form, entry) === 'runtime') ? 'runtime' : 'static';
  const canonicalBehavior = getBundleBehavior(form);

  const applyQuantityMode = (mode: 'static' | 'fill-to-max' | 'runtime') => {
    setModeError(null);
    if (mode === 'fill-to-max') {
      const firstEntitlement = form.items.find(entry => Boolean(entry.entitlementId));
      if (!firstEntitlement) {
        setModeError('Fill-to-max requires one entitlement entry. Add an entitlement before selecting this mode.');
        return;
      }
      if (form.items.length !== 1 || !firstEntitlement.entitlementId) {
        setModeConfirmation('fill-to-max');
        return;
      }
      setForm({ ...form, dynamicRemaining: false, items: [{ ...firstEntitlement, quantity: 1, quantityBehavior: 'fill-to-max' }] });
      return;
    }
    setForm({
      ...form,
      dynamicRemaining: false,
      items: form.items.map(entry => ({
        ...entry,
        quantityBehavior: mode === 'runtime' && entry.entitlementId ? 'runtime' : undefined,
        quantity: entry.quantity,
      })),
    });
  };

  const requestQuantityMode = (mode: 'static' | 'fill-to-max' | 'runtime') => {
    if (mode === 'fill-to-max' && !form.items.some(entry => Boolean(entry.entitlementId))) {
      setModeError('Fill-to-max requires one entitlement entry. Add an entitlement before selecting this mode.');
      return;
    }
    applyQuantityMode(mode);
  };

  const toggleEntitlement = (item: EntitlementItem, checked: boolean) => {
    setModeError(null);
    if (!checked) {
      setForm({ ...form, items: form.items.filter(entry => entry.entitlementId !== item.id) });
      return;
    }
    if (quantityMode === 'fill-to-max' && form.items.length > 0) {
      setModeError('Fill-to-max is limited to one entitlement. Remove the current entry or choose another quantity mode.');
      return;
    }
    const nextEntry: BundleOfferItem = {
      entitlementId: item.id,
      quantity: 1,
      quantityBehavior: quantityMode === 'fill-to-max' ? 'fill-to-max' : quantityMode === 'runtime' ? 'runtime' : undefined,
    };
    setForm({ ...form, items: [...form.items.filter(entry => entry.entitlementId !== item.id), nextEntry] });
  };

  const toggleNestedBundle = (candidate: BundleOffer, checked: boolean) => {
    setModeError(null);
    if (!checked) {
      setForm({ ...form, items: form.items.filter(entry => entry.bundleId !== candidate.id) });
      return;
    }
    if (quantityMode === 'fill-to-max') {
      setModeError('Fill-to-max is limited to one entitlement and cannot include nested bundles.');
      return;
    }
    setForm({
      ...form,
      items: [...form.items.filter(entry => entry.bundleId !== candidate.id), {
        bundleId: candidate.id,
        quantity: 1,
        quantityBehavior: undefined,
      }],
    });
  };

  const commitForm = () => {
    if (errors.length > 0) return;
    if (pendingIconUpload) {
      setPendingAction('save');
      return;
    }
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onMouseDown={event => { if (event.currentTarget === event.target) requestClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="bundle-dialog-title" tabIndex={-1} className="flex min-h-0 w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-3xl border border-slate-700 bg-[#0d1326] shadow-2xl outline-none">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 id="bundle-dialog-title" className="font-bold text-white">{isExisting ? 'Edit bundle offer' : 'Create bundle offer'}</h2>
          <button type="button" aria-label="Close bundle editor" onClick={requestClose} className="p-2 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={event => { event.preventDefault(); commitForm(); }} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-slate-300">Display name
                <input aria-label="Bundle display name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className={fieldClass('utm-native-field mt-1 w-full bg-slate-950 border rounded-lg px-3 py-2 border-slate-700', 'name')} />
                <InlineWarnings issues={warningsFor('name')} />
              </label>
              <label className="text-xs text-slate-300 sm:col-span-2">Short description (up to {MARKETPLACE_CONSTRAINTS.shortDescriptionMaxCharacters} characters)
                <input aria-label="Bundle short description" value={form.shortDescription} onChange={event => setForm({ ...form, shortDescription: event.target.value })} className={fieldClass('utm-native-field mt-1 w-full bg-slate-950 border rounded-lg px-3 py-2 border-slate-700', 'shortDescription')} />
                <InlineWarnings issues={warningsFor('shortDescription')} />
              </label>
              <label className="text-xs text-slate-300 sm:col-span-2">Description (up to {MARKETPLACE_CONSTRAINTS.descriptionMaxCharacters} characters before generated disclosures)
                <span className={fieldClass('utm-native-textarea-shell mt-1 block rounded-lg border bg-slate-950 border-slate-700', 'description')}><textarea aria-label="Bundle full description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className="utm-native-field block w-full resize-none overflow-x-hidden overflow-y-auto border-0 bg-transparent px-3 py-2" /></span>
                <InlineWarnings issues={warningsFor('description')} />
              </label>
              <div className="sm:col-span-2">
                <VBucksPriceControl id="bundle-price" ariaLabel="Bundle price in V-Bucks" value={form.priceVBucks} onChange={value => setForm({ ...form, priceVBucks: value })} />
              </div>
              <div data-bundle-icon-editor="true" className="sm:col-span-2 text-xs text-slate-300">
                <p className="font-medium">Bundle icon</p>
                <div className="mt-1">
                  <ImageUploadZone
                    key={form.id}
                    ref={imageUploadRef}
                    contentFolderPath={contentFolderPath}
                    assetFolderName={assetFolderName}
                    assetName={form.verseKey || 'bundle_icon'}
                    currentTextureRef={form.iconTexture}
                    currentImageData={form.iconImageData ?? (isPlaceholderIconTexture(form.iconTexture) ? PLACEHOLDER_ICON_DATA_URL : undefined)}
                    isPlaceholder={isPlaceholderIconTexture(form.iconTexture)}
                    nativeTextureImportAvailable={editorStatus?.nativeTextureImportAvailable === true}
                    onTextureRefChange={texture => setForm(previous => previous ? { ...previous, iconTexture: texture } : previous)}
                    onImageDataChange={(data, fileName) => setForm(previous => previous ? { ...previous, iconImageData: data, iconFileName: fileName } : previous)}
                    onPendingStateChange={setPendingIconUpload}
                  />
                </div>
              </div>
              <label className="text-xs text-slate-300 sm:col-span-2">Duration disclosure
                <input aria-label="Bundle duration disclosure" value={form.durationDescription ?? ''} onChange={event => setForm({ ...form, durationDescription: event.target.value })} placeholder="e.g. Lasts 7 days after purchase" className={fieldClass('utm-native-field mt-1 w-full bg-slate-950 border rounded-lg px-3 py-2 border-slate-700', 'durationDescription')} />
                <InlineWarnings issues={warningsFor('durationDescription')} />
              </label>
              <div className="sm:col-span-2"><OfferRestrictionsEditor compact restrictions={{ blockedCountryCodes: [], blockedPlatformFamilies: [], ...form.restrictions }} onChange={restrictions => setForm({ ...form, restrictions })} /></div>
            </div>

            <fieldset className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 space-y-3">
              <legend className="px-1 text-xs font-extrabold text-cyan-200">Price source</legend>
              <label className="flex items-center justify-between gap-3 text-xs text-slate-300"><span><span className="block font-bold text-white">How is this price set?</span><span className="text-slate-400">Choose a fixed catalog price or let your project supply it at purchase time.</span></span><select aria-label="Bundle price behavior" value={form.dynamicOffer?.priceBehavior ?? 'fixed'} onChange={event => setForm({ ...form, dynamicOffer: event.target.value === 'runtime' ? { priceBehavior: 'runtime' } : undefined })} className="utm-native-select w-48 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs"><option value="fixed">Fixed price</option><option value="runtime">Set by Verse at runtime</option></select></label>
              <p className="text-[11px] leading-5 text-slate-400">For runtime pricing, project Verse supplies the player-specific price when the purchase opens. Runtime bundles are direct-purchase only.</p>
            </fieldset>

            <fieldset className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4 space-y-2">
              <legend className="px-1 text-xs font-extrabold text-violet-200">Quantity mode</legend>
              <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
                <span><span className="block font-bold text-white">How are included quantities supplied?</span><span className="text-slate-400">Fill-to-max is a dedicated single-entitlement mode.</span></span>
                <select aria-label="Bundle quantity mode" value={quantityMode} onChange={event => requestQuantityMode(event.target.value as 'static' | 'fill-to-max' | 'runtime')} className="utm-native-select w-48 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs">
                  <option value="static">Fixed quantities</option>
                  <option value="fill-to-max">Fill to player maximum</option>
                  <option value="runtime">Set quantities by Verse</option>
                </select>
              </label>
              <p className="text-[11px] leading-5 text-slate-400">Static bundles use the quantities below. Runtime quantities must be supplied by Verse. Fill-to-max keeps exactly one entitlement entry and uses its configured MaxCount at purchase time.</p>
              {canonicalBehavior.mode === 'invalid' && <p className="flex items-start gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] leading-4 text-rose-300"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{canonicalBehavior.reason}</p>}
              {modeError && <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-200">{modeError}</p>}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-bold text-slate-300">Included entitlements</legend>
              {entitlements.map(item => {
                const entry = form.items.find(candidate => candidate.entitlementId === item.id);
                const behavior = entry ? bundleQuantityBehavior(form, entry) : 'fixed';
                return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-3">
                  <label className="flex items-center gap-2 text-xs text-white"><input type="checkbox" checked={Boolean(entry)} onChange={event => toggleEntitlement(item, event.target.checked)} /> <OfferIcon texture={item.iconTexture} imageData={item.iconImageData} className="h-7 w-7" alt="" /> <span>{item.name}</span></label>
                  {entry && <div className="flex flex-wrap items-center justify-end gap-2">
                    <select aria-label={item.name + ' offer variant'} value={entry.offerVerseKey ?? ''} onChange={event => setForm({ ...form, items: form.items.map(candidate => candidate.entitlementId === item.id ? { ...candidate, offerVerseKey: event.target.value || undefined } : candidate) })} className="utm-native-select w-32 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"><option value="">Default offer</option>{(item.alternateOffers ?? []).map(offer => <option key={offer.id} value={offer.verseKey}>{offer.name}</option>)}</select>
                    {behavior === 'fixed' && <NumericInput ariaLabel={item.name + ' quantity'} min={1} max={item.maxCount} value={entry.quantity} onChange={value => setForm({ ...form, items: form.items.map(candidate => candidate.entitlementId === item.id ? { ...candidate, quantity: value } : candidate) })} className="w-14 text-xs" />}
                    {behavior === 'fill-to-max' && <span className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-200">Fill to player maximum</span>}
                    {behavior === 'runtime' && <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200">Set by Verse at runtime</span>}
                  </div>}
                </div>;
              })}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-bold text-slate-300">Nested bundles</legend>
              {bundles.filter(candidate => candidate.id !== form.id).map(candidate => {
                const entry = form.items.find(item => item.bundleId === candidate.id);
                return <div key={candidate.id} className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <label className="flex items-center gap-2 text-xs text-white"><input type="checkbox" checked={Boolean(entry)} onChange={event => toggleNestedBundle(candidate, event.target.checked)} /> <OfferIcon texture={candidate.iconTexture} imageData={candidate.iconImageData} className="h-7 w-7" alt="" /> <span>{candidate.name}</span></label>
                  {entry && <NumericInput ariaLabel={candidate.name + ' quantity'} min={1} value={entry.quantity} onChange={value => setForm({ ...form, items: form.items.map(item => item.bundleId === candidate.id ? { ...item, quantity: value } : item) })} className="w-14 text-xs" />}
                </div>;
              })}
            </fieldset>

            {errors.length > 0 && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300" role="alert">{errors.map(error => <p key={error.id}>{error.message}</p>)}</div>}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-800 bg-slate-900/50 px-6 py-4">
            <button type="button" onClick={requestClose} className="px-4 py-2 text-xs">Cancel</button>
            <button type="submit" disabled={errors.length > 0} className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 text-slate-950 disabled:opacity-50">Save bundle</button>
          </div>
        </form>
        {pendingAction && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#080c14]/85 p-6 backdrop-blur-sm">
            <div ref={pendingIconDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="pending-bundle-icon-title" tabIndex={-1} className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#0d1326] p-5 shadow-2xl">
              <h3 id="pending-bundle-icon-title" className="text-sm font-extrabold text-white">Confirm this icon before saving</h3>
              <p className="mt-2 text-xs leading-5 text-slate-300">The selected PNG is only a preview right now. It has not been imported and saved as a native Texture2D in the active UEFN project.</p>
              <p className="mt-2 text-xs leading-5 text-amber-300">Keep UEFN open while the manager confirms the import. The bundle will save after the import succeeds.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button ref={pendingIconCancelRef} type="button" onClick={() => setPendingAction(null)} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Continue editing</button>
                <button type="button" onClick={() => void confirmPendingIcon()} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-cyan-300">Confirm &amp; import, then save</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <DraftConfirmDialog
        open={dirtyConfirmationOpen}
        isNew={!isExisting}
        subject="bundle offer"
        onSave={() => { setDirtyConfirmationOpen(false); commitForm(); }}
        onDiscard={() => { setDirtyConfirmationOpen(false); onClose(); }}
        onContinue={() => setDirtyConfirmationOpen(false)}
      />
      <ConfirmDialog
        open={modeConfirmation === 'fill-to-max'}
        title="Convert to fill-to-max?"
        description="Fill-to-max is limited to one entitlement. Confirming keeps the first entitlement entry and removes the other bundle entries from this draft."
        confirmLabel="Convert quantity mode"
        onCancel={() => setModeConfirmation(null)}
        onConfirm={() => {
          const first = form.items.find(entry => Boolean(entry.entitlementId));
          if (first?.entitlementId) setForm({ ...form, dynamicRemaining: false, items: [{ ...first, quantity: 1, quantityBehavior: 'fill-to-max' }] });
          setModeConfirmation(null);
        }}
      />
    </div>
  );
};
