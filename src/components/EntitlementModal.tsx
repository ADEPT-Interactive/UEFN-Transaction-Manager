import React, { useEffect, useRef, useState } from 'react';
import { 
  X, 
  Sparkles, 
  Layers, 
  RotateCw, 
  Infinity as InfinityIcon, 
  Lock, 
  Dice5, 
  ShieldCheck, 
  Radio, 
  Save,
  CheckCircle2,
  AlertCircle,
  Code,
  SlidersHorizontal,
  ExternalLink
} from 'lucide-react';
import { AlternateOffer, EntitlementItem, OfferRestrictions } from '../types/entitlement';
import { sanitizeVerseIdentifier, validateEntitlement } from '../services/validator';
import { createVerseKeyAllocator, draftVerseKeyForName } from '../services/verseIdentity';
import { handleExternalLinkClick } from '../services/externalLink';
import { PAID_RANDOM_ITEM_GUIDANCE_URL } from '../constants/docs';
import { ConfirmedTextureImport, ImageUploadZone, ImageUploadZoneHandle } from './ImageUploadZone';
import { OfferRestrictionsEditor } from './OfferRestrictionsEditor';
import { VBucksIcon } from './VBucksIcon';

interface EntitlementModalProps {
  isOpen: boolean;
  item: EntitlementItem | null;
  contentFolderPath: string;
  assetFolderName: string;
  allEntitlements: EntitlementItem[];
  onSave: (item: EntitlementItem) => void;
  onClose: () => void;
}

const EMPTY_ENTITLEMENT: EntitlementItem = {
  id: '', verseKey: '', name: '', shortDescription: '', description: '', priceVBucks: 100,
  itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: '',
  flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
  purchaseEventName: '', restoreOnJoin: true,
  triggers: { generateTriggerBinding: true, generateButtonBinding: false, generateZoneBinding: false },
};

const EMPTY_RESTRICTIONS: OfferRestrictions = { blockedCountryCodes: [], blockedPlatformFamilies: [] };

export const EntitlementModal: React.FC<EntitlementModalProps> = ({
  isOpen,
  item,
  contentFolderPath,
  assetFolderName,
  allEntitlements,
  onSave,
  onClose,
}) => {
  const [formData, setFormData] = useState<EntitlementItem>(() => item ?? EMPTY_ENTITLEMENT);
  const [activeTab, setActiveTab] = useState<'general' | 'icon' | 'behavior' | 'hooks'>('general');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const imageUploadRef = useRef<ImageUploadZoneHandle>(null);
  const [pendingIconUpload, setPendingIconUpload] = useState(false);
  const [pendingAction, setPendingAction] = useState<'save' | 'close' | null>(null);

  const requestClose = () => {
    if (pendingIconUpload) {
      setPendingAction('close');
      return;
    }
    onClose();
  };

  const confirmPendingIcon = async () => {
    const action = pendingAction;
    if (!action) return;
    const confirmed: ConfirmedTextureImport | null = await imageUploadRef.current?.confirmPendingImport() ?? null;
    if (!confirmed) return;
    const nextItem = {
      ...formData,
      iconTexture: confirmed.verseAssetPath,
      iconImageData: confirmed.preview,
      iconFileName: confirmed.fileName,
    };
    setFormData(nextItem);
    setPendingAction(null);
    if (action === 'close') onClose();
    else onSave(nextItem);
  };

  useEffect(() => {
    if (isOpen && item) {
      setFormData({ ...item });
      setActiveTab('general');
      setShowAdvanced(false);
      setPendingIconUpload(false);
      setPendingAction(null);
    }
  }, [isOpen, item]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (pendingIconUpload) setPendingAction('close');
        else onClose();
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex]:not([tabindex="-1"])')).filter(element => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [isOpen, onClose, pendingIconUpload]);

  if (!isOpen || !item) return null;

  // Handle price quick-select
  const setPrice = (amount: number) => {
    setFormData(prev => ({ ...prev, priceVBucks: Math.max(50, Math.min(5000, amount)) }));
  };

  // Drafts may follow their display name. Persisted keys never do.
  const handleNameChange = (newName: string) => {
    setFormData(prev => {
      const isExisting = !item.id.startsWith('new-');
      const nextKey = draftVerseKeyForName(prev.verseKey, prev.name, newName, isExisting);
      const defaultTrigger = `${prev.verseKey}_OfferTriggers`;
      const defaultButton = `${prev.verseKey}_Buttons`;
      const defaultZone = `${prev.verseKey}_Zones`;
      return {
        ...prev,
        name: newName,
        verseKey: nextKey,
        triggers: {
          ...prev.triggers,
          triggerDeviceName: !isExisting && prev.triggers.triggerDeviceName === defaultTrigger ? `${nextKey}_OfferTriggers` : prev.triggers.triggerDeviceName,
          buttonDeviceName: !isExisting && prev.triggers.buttonDeviceName === defaultButton ? `${nextKey}_Buttons` : prev.triggers.buttonDeviceName,
          mutatorZoneName: !isExisting && prev.triggers.mutatorZoneName === defaultZone ? `${nextKey}_Zones` : prev.triggers.mutatorZoneName,
        },
      };
    });
  };

  const updateRestrictions = (patch: Partial<OfferRestrictions>) => {
    setFormData(previous => ({ ...previous, offerRestrictions: { ...EMPTY_RESTRICTIONS, ...previous.offerRestrictions, ...patch } }));
  };

  const addAlternateOffer = () => {
    setFormData(previous => {
      const usedKeys = allEntitlements.flatMap(entitlement => [entitlement.verseKey, ...(entitlement.alternateOffers ?? []).map(offer => offer.verseKey)]);
      const allocator = createVerseKeyAllocator(usedKeys);
      for (const offer of previous.alternateOffers ?? []) allocator.reserveExisting(offer.verseKey);
      const index = (previous.alternateOffers ?? []).length + 1;
      const key = allocator.allocateAlternate(previous.verseKey || 'offer');
      const offer: AlternateOffer = {
        id: `new-alt-${crypto.randomUUID()}`,
        verseKey: key,
        name: `${previous.name || 'Offer'} Alternate ${index}`,
        shortDescription: previous.shortDescription,
        description: previous.description,
        priceVBucks: previous.priceVBucks,
        iconTexture: previous.iconTexture,
        restrictions: { ...EMPTY_RESTRICTIONS },
      };
      return { ...previous, alternateOffers: [...(previous.alternateOffers ?? []), offer] };
    });
  };

  const validationIssues = validateEntitlement(formData, allEntitlements);
  const errors = validationIssues.filter(i => i.severity === 'error');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (errors.length > 0) {
      return;
    }
    if (pendingIconUpload) {
      setPendingAction('save');
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto" onMouseDown={event => { if (event.currentTarget === event.target) requestClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="entitlement-dialog-title" tabIndex={-1} className="relative w-full max-w-2xl bg-[#0d1326] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-modal flex flex-col max-h-[90vh] outline-none">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 font-bold shadow-md shadow-cyan-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 id="entitlement-dialog-title" className="font-extrabold text-base text-white">
                {item.id.includes('new') ? 'Create Offer' : `Edit offer: ${formData.name || formData.verseKey}`}
              </h2>
              <p className={`text-xs text-slate-400 ${showAdvanced ? 'font-mono' : ''}`}>
                {showAdvanced ? `${formData.verseKey}_entitlement` : 'Add the storefront details players will see.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1"><button type="button" onClick={() => { if (showAdvanced && activeTab === 'hooks') setActiveTab('general'); setShowAdvanced(open => !open); }} aria-pressed={showAdvanced} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold transition-colors ${showAdvanced ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><SlidersHorizontal className="h-3.5 w-3.5" />Advanced</button><button
              type="button"
              aria-label="Close offer editor"
              onClick={requestClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button></div>
        </div>

        {/* Modal Navigation Tabs */}
        <div role="tablist" aria-label="Offer editor sections" className="flex border-b border-slate-800 bg-[#090e1a] px-6 gap-1">
          <button
            type="button"
            id="offer-tab-general"
            role="tab"
            aria-selected={activeTab === 'general'}
            aria-controls="offer-editor-panel"
            onClick={() => setActiveTab('general')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'general'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <VBucksIcon className="h-3.5 w-3.5" />
            <span>General & Pricing</span>
          </button>

          <button
            type="button"
            id="offer-tab-icon"
            role="tab"
            aria-selected={activeTab === 'icon'}
            aria-controls="offer-editor-panel"
            onClick={() => setActiveTab('icon')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'icon'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Icon & Texture</span>
          </button>

          <button
            type="button"
            id="offer-tab-behavior"
            role="tab"
            aria-selected={activeTab === 'behavior'}
            aria-controls="offer-editor-panel"
            onClick={() => setActiveTab('behavior')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'behavior'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Behavior & Moderation</span>
          </button>

          {showAdvanced && <button
            type="button"
            id="offer-tab-hooks"
            role="tab"
            aria-selected={activeTab === 'hooks'}
            aria-controls="offer-editor-panel"
            onClick={() => setActiveTab('hooks')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'hooks'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Triggers & Hooks</span>
          </button>}
        </div>

        {/* Modal Scrollable Body */}
        <form id="offer-editor-panel" role="tabpanel" aria-labelledby={`offer-tab-${activeTab}`} onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* TAB 1: General & Pricing */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              
              {/* Display Title */}
              <div>
                <label htmlFor="offer-display-name" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Display Title (Name) *
                </label>
                <input
                  id="offer-display-name"
                  type="text"
                  required
                  maxLength={50}
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. ⭐ VIP Pass or +10 Strength Boost"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-cyan-400 font-medium"
                />
              </div>

              {/* Verse Identifier Symbol */}
              {showAdvanced && <div>
                <label htmlFor="offer-verse-key" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>Verse Identifier Key *</span>
                  <span className="text-[10px] text-slate-500 lowercase">letters, numbers, underscore only</span>
                </label>
                <div className="relative">
                  <input
                    id="offer-verse-key"
                    type="text"
                    required
                  value={formData.verseKey}
                    onChange={(e) => setFormData(prev => ({ ...prev, verseKey: sanitizeVerseIdentifier(e.target.value) }))}
                    placeholder="e.g. vip_pass or strength_boost_10"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm font-mono text-cyan-300 focus:outline-none focus:border-cyan-400 font-semibold"
                  />
                </div>
              </div>}

              {/* Descriptions */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label htmlFor="offer-short-description" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Short Description (Storefront Popup)
                  </label>
                  <input
                    id="offer-short-description"
                    type="text"
                    required
                    maxLength={100}
                    value={formData.shortDescription}
                    onChange={(e) => setFormData(prev => ({ ...prev, shortDescription: e.target.value }))}
                    placeholder="e.g. Unlock exclusive VIP conveyors & badge!"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label htmlFor="offer-full-description" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Full Description
                  </label>
                  <textarea
                    id="offer-full-description"
                    rows={2}
                    required
                    maxLength={500}
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Detailed explanation of the entitlement and its in-game effects..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label htmlFor="offer-duration" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Duration disclosure (if time-limited)</label>
                  <input id="offer-duration" type="text" maxLength={100} value={formData.durationDescription ?? ''} onChange={e => setFormData(previous => ({ ...previous, durationDescription: e.target.value }))} placeholder="e.g. Lasts 7 days after purchase" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400" />
                </div>
              </div>

              {/* V-Bucks Price Configuration */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="offer-price" className="text-xs font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                    <VBucksIcon className="h-4 w-4 text-sky-400" />
                    <span>Price in V-Bucks (50 – 5,000 VB, Step 50)</span>
                  </label>
                  <span className="font-mono text-base font-extrabold text-sky-400">
                    <span className="inline-flex items-center gap-1.5"><VBucksIcon className="h-4 w-4" />{formData.priceVBucks} V-Bucks</span>
                  </span>
                </div>

                {/* Price input & slider */}
                <div className="flex items-center gap-3">
                  <input
                    id="offer-price"
                    type="number"
                    min={50}
                    max={5000}
                    step={50}
                    value={formData.priceVBucks}
                    onChange={(e) => setFormData(prev => ({ ...prev, priceVBucks: parseInt(e.target.value, 10) || 50 }))}
                    className="w-32 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-sky-400 text-center"
                  />
                  <input
                    aria-label="Offer price in V-Bucks"
                    type="range"
                    min={50}
                    max={5000}
                    step={50}
                    value={formData.priceVBucks}
                    onChange={(e) => setFormData(prev => ({ ...prev, priceVBucks: parseInt(e.target.value, 10) }))}
                    className="flex-1 accent-sky-400 h-2 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Quick Price Buttons */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[50, 100, 150, 200, 400, 500, 1000, 2000, 5000].map(amount => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setPrice(amount)}
                      className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border transition-all ${
                        formData.priceVBucks === amount
                          ? 'bg-sky-500 text-slate-950 border-sky-400'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {amount}
                    </button>
                  ))}
                </div>
              </div>

              {showAdvanced && <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <OfferRestrictionsEditor restrictions={{ blockedCountryCodes: [], blockedPlatformFamilies: [], ...formData.offerRestrictions }} onChange={restrictions => setFormData(previous => ({ ...previous, offerRestrictions: restrictions }))} />
              </div>}

              {showAdvanced && <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between"><div><p className="text-xs font-bold text-cyan-300 uppercase tracking-wider">Alternate offers</p><p className="text-[11px] text-slate-400">Create region/platform/price variants that bundles can reference.</p></div><button type="button" onClick={addAlternateOffer} className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 text-xs font-bold">Add variant</button></div>
                {(formData.alternateOffers ?? []).map((offer, index) => (
                  <div key={offer.id} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 space-y-2">
                    <div className="flex justify-between gap-2"><span className="text-xs font-bold text-white">Variant {index + 1}</span><button type="button" onClick={() => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).filter(candidate => candidate.id !== offer.id) }))} className="text-xs text-rose-300">Remove</button></div>
                    <div className="grid grid-cols-2 gap-2">
                      <input aria-label={`Variant ${index + 1} name`} value={offer.name} onChange={e => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, name: e.target.value } : candidate) }))} placeholder="Variant name" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs" />
                      <input aria-label={`Variant ${index + 1} Verse key`} value={offer.verseKey} onChange={e => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, verseKey: sanitizeVerseIdentifier(e.target.value) } : candidate) }))} placeholder="variant_key" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono text-cyan-300" />
                      <input aria-label={`Variant ${index + 1} price in V-Bucks`} type="number" min={50} max={5000} step={50} value={offer.priceVBucks} onChange={e => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, priceVBucks: Number(e.target.value) } : candidate) }))} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs" />
                      <input aria-label={`Variant ${index + 1} icon texture`} value={offer.iconTexture} onChange={e => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, iconTexture: e.target.value } : candidate) }))} placeholder="Icons.Variant" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono" />
                    </div>
                    <input aria-label={`Variant ${index + 1} short description`} value={offer.shortDescription} onChange={e => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, shortDescription: e.target.value } : candidate) }))} placeholder="Short description" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs" />
                    <textarea aria-label={`Variant ${index + 1} full description`} rows={2} value={offer.description} onChange={e => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, description: e.target.value } : candidate) }))} placeholder="Full description" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs" />
                    <input aria-label={`Variant ${index + 1} duration disclosure`} value={offer.durationDescription ?? ''} onChange={e => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, durationDescription: e.target.value } : candidate) }))} placeholder="Duration disclosure, if time-limited" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs" />
                    <OfferRestrictionsEditor compact restrictions={offer.restrictions} onChange={restrictions => setFormData(previous => ({ ...previous, alternateOffers: (previous.alternateOffers ?? []).map(candidate => candidate.id === offer.id ? { ...candidate, restrictions } : candidate) }))} />
                  </div>
                ))}
              </div>}
            </div>
          )}

          {/* TAB 2: Icon & Texture */}
          {activeTab === 'icon' && (
            <div className="space-y-4">
                <ImageUploadZone
                 key={item.id}
                 ref={imageUploadRef}
                  contentFolderPath={contentFolderPath}
                assetFolderName={assetFolderName}
                assetName={formData.verseKey || 'icon'}
                currentTextureRef={formData.iconTexture}
                  currentImageData={formData.iconImageData}
                  onTextureRefChange={(ref) => setFormData(prev => ({ ...prev, iconTexture: ref }))}
                  onImageDataChange={(base64, fileName) => setFormData(prev => ({ ...prev, iconImageData: base64, iconFileName: fileName }))}
                  onPendingStateChange={setPendingIconUpload}
                />
            </div>
          )}

          {/* TAB 3: Behavior & Moderation */}
          {activeTab === 'behavior' && (
            <div className="space-y-4">
              
              {/* Item Type: Durable vs Consumable */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Item Lifetime & Type *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  
                  {/* Durable */}
                  <button
                    type="button"
                    aria-pressed={formData.itemType === 'durable'}
                    onClick={() => setFormData(prev => ({ ...prev, itemType: 'durable', maxCount: 1, autoConsume: false }))}
                    className={`w-full cursor-pointer border rounded-2xl p-3.5 text-left transition-all flex flex-col justify-between ${
                      formData.itemType === 'durable'
                        ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/10'
                        : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <InfinityIcon className="w-4 h-4 text-purple-400" />
                      <span className="text-xs font-bold text-white">Durable (Permanent)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Player owns forever. MaxCount is always 1. Cannot be consumed or repurchased once owned.
                    </p>
                  </button>

                  {/* Consumable */}
                  <button
                    type="button"
                    aria-pressed={formData.itemType === 'consumable'}
                    onClick={() => setFormData(prev => ({ ...prev, itemType: 'consumable' }))}
                    className={`w-full cursor-pointer border rounded-2xl p-3.5 text-left transition-all flex flex-col justify-between ${
                      formData.itemType === 'consumable'
                        ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10'
                        : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <RotateCw className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-white">Consumable (Repeatable)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Can be consumed/spent and repurchased. Supports custom MaxCount stacks and auto-consumption.
                    </p>
                  </button>
                </div>
              </div>

              {/* Consumable Options (MaxCount & AutoConsume) */}
              {formData.itemType === 'consumable' && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-amber-300">Max Holding Count (MaxCount)</p>
                      <p className="text-[11px] text-slate-400">Maximum stack the player can hold at one time.</p>
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={10000000}
                      value={formData.maxCount}
                      onChange={(e) => setFormData(prev => ({ ...prev, maxCount: parseInt(e.target.value, 10) || 1 }))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-white text-center"
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-amber-500/20 pt-3">
                    <div>
                      <p className="text-xs font-bold text-amber-300">Immediate Auto-Consumption</p>
                      <p className="text-[11px] text-slate-400">Automatically consume upon purchase to grant instant reward and free inventory.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.autoConsume}
                      onChange={(e) => setFormData(prev => ({ ...prev, autoConsume: e.target.checked }))}
                      className="w-4 h-4 accent-amber-400 rounded cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* In-Island Transaction & Moderation Flags */}
              <div className="space-y-3 pt-2">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Fortnite In-Island Transaction Moderation Flags
                </label>

                {/* Paid Random Item */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.flags.paidRandomItem}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          flags: { ...prev.flags, paidRandomItem: e.target.checked },
                        }))}
                        className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
                      />
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Dice5 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Paid Random Item</span>
                      </span>
                    </label>
                  </div>
                  {formData.flags.paidRandomItem && (
                    <div className="pt-2 border-t border-slate-800">
                      <label htmlFor="paid-random-odds" className="block text-[11px] font-medium text-rose-300 mb-1">
                        Optional odds disclosure
                      </label>
                      <p className="mb-2 text-[11px] leading-4 text-slate-400">
                        Accurate numerical odds are required before purchase. This UEM field is optional: enter them here to add them to generated descriptions, or disclose them elsewhere in your island and clearly direct players there. Leaving it empty is allowed in UEM, but does not remove the underlying requirement.{' '}
                        <a href={PAID_RANDOM_ITEM_GUIDANCE_URL} target="_blank" rel="noreferrer" onClick={event => handleExternalLinkClick(event, PAID_RANDOM_ITEM_GUIDANCE_URL)} className="inline-flex items-center gap-1 text-cyan-300 hover:underline">
                          Epic guidance <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                      <input
                        id="paid-random-odds"
                        type="text"
                        value={formData.flags.paidRandomItemOdds}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          flags: { ...prev.flags, paidRandomItemOdds: e.target.value },
                        }))}
                        placeholder="e.g. Common: 60%, Rare: 30%, Legendary: 10%"
                        className="w-full bg-slate-950 border border-amber-500/40 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  )}
                </div>

                {/* Paid Area */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.flags.paidArea}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        flags: { ...prev.flags, paidArea: e.target.checked },
                      }))}
                      className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
                    />
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-blue-400" />
                      <span>Paid Area (Restricted Room / Paywall Gate)</span>
                    </span>
                  </label>
                </div>

                {/* Consequential to Gameplay */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.flags.consequentialToGameplay}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        flags: { ...prev.flags, consequentialToGameplay: e.target.checked },
                      }))}
                      className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                    />
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Consequential to Gameplay (Provides Player Advantage/Stats)</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Triggers & Hooks */}
          {activeTab === 'hooks' && (
            <div className="space-y-4">
              
              {/* Stable public event contract */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                <label className="block text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Positive Entitlement Change Event</span>
                </label>
                <p className="text-[11px] text-slate-400">The device signals this public event after any positive Marketplace entitlement delta, including a purchase or direct grant. Existing legacy “PurchasedEvent” names remain compatible.</p>
                <input type="text" value={formData.purchaseEventName} onChange={event => setFormData(previous => ({ ...previous, purchaseEventName: event.target.value }))} placeholder="VipPassGrantedEvent" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-emerald-300" />
                {formData.itemType === 'durable' && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={formData.restoreOnJoin} onChange={event => setFormData(previous => ({ ...previous, restoreOnJoin: event.target.checked }))} />Generate and signal a separate OwnershipVerifiedEvent on join</label>}
              </div>

              {/* Triggers (Trigger devices, Buttons & Mutator Zones) */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                <label className="block text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  <span>In-Game Triggers & Bindings</span>
                </label>

                <div className="border-b border-slate-800 pb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.triggers.generateTriggerBinding}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        triggers: {
                          ...prev.triggers,
                          generateTriggerBinding: e.target.checked,
                          triggerDeviceName: e.target.checked ? (prev.triggers.triggerDeviceName || `${prev.verseKey}_OfferTriggers`) : undefined,
                        },
                      }))}
                      className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-white">Expose Trigger Devices for this offer</span>
                  </label>
                  <p className="mt-1 pl-6 text-[11px] text-slate-400">Recommended: assign one or more Trigger devices in UEFN. A player-triggered event opens this offer.</p>
                  {formData.triggers.generateTriggerBinding && (
                    <input
                      type="text"
                      value={formData.triggers.triggerDeviceName || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        triggers: { ...prev.triggers, triggerDeviceName: e.target.value },
                      }))}
                      className="mt-2 ml-6 w-52 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-cyan-300"
                      placeholder="Offer Trigger Array"
                    />
                  )}
                </div>

                {/* Button Device Trigger */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.triggers.generateButtonBinding}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        triggers: {
                          ...prev.triggers,
                          generateButtonBinding: e.target.checked,
                          buttonDeviceName: e.target.checked ? `${prev.verseKey}_Buttons` : undefined,
                        },
                      }))}
                      className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-white">Generate Button Devices Array Binding</span>
                  </label>
                  {formData.triggers.generateButtonBinding && (
                    <input
                      type="text"
                      value={formData.triggers.buttonDeviceName || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        triggers: { ...prev.triggers, buttonDeviceName: e.target.value },
                      }))}
                      className="w-40 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-cyan-300"
                      placeholder="Button Array Name"
                    />
                  )}
                </div>

                {/* Mutator Zone Trigger */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.triggers.generateZoneBinding}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        triggers: {
                          ...prev.triggers,
                          generateZoneBinding: e.target.checked,
                          mutatorZoneName: e.target.checked ? `${prev.verseKey}_Zones` : undefined,
                        },
                      }))}
                      className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-white">Generate Mutator Zone Trigger Binding</span>
                  </label>
                  {formData.triggers.generateZoneBinding && (
                    <input
                      type="text"
                      value={formData.triggers.mutatorZoneName || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        triggers: { ...prev.triggers, mutatorZoneName: e.target.value },
                      }))}
                      className="w-40 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-cyan-300"
                      placeholder="Zone Array Name"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Validation Warnings inside Modal */}
          {validationIssues.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1.5">
              {validationIssues.map(issue => (
                <div key={issue.id} className="flex items-start gap-2 text-xs">
                  {issue.severity === 'error' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className={issue.severity === 'error' ? 'text-rose-300 font-medium' : 'text-amber-300'}>
                    <span>{issue.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Modal Footer Controls */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={requestClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={errors.length > 0}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Save Offer</span>
            </button>
          </div>
        </form>
        {pendingAction && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#080c14]/85 p-6 backdrop-blur-sm">
            <div role="alertdialog" aria-modal="true" aria-labelledby="pending-icon-title" className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#0d1326] p-5 shadow-2xl">
              <h3 id="pending-icon-title" className="text-sm font-extrabold text-white">Confirm this icon before continuing</h3>
              <p className="mt-2 text-xs leading-5 text-slate-300">The selected PNG is only a preview right now. It has not been imported and saved as a native Texture2D in the active UEFN project.</p>
              <p className="mt-2 text-xs leading-5 text-amber-300">Keep UEFN open while the manager confirms the import. {pendingAction === 'save' ? 'The offer will save after the import succeeds.' : 'The editor will close after the import succeeds.'}</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setPendingAction(null)} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Continue editing</button>
                <button type="button" onClick={() => void confirmPendingIcon()} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-cyan-300">Confirm &amp; import{pendingAction === 'save' ? ', then save' : ', then close'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
