import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Coins, 
  Layers, 
  RotateCw, 
  Infinity as InfinityIcon, 
  Lock, 
  Dice5, 
  ShieldCheck, 
  Code, 
  Radio, 
  Bell, 
  Save,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { EntitlementItem, ActionHookType } from '../types/entitlement';
import { sanitizeVerseIdentifier, validateEntitlement } from '../services/validator';
import { ImageUploadZone } from './ImageUploadZone';

interface EntitlementModalProps {
  isOpen: boolean;
  item: EntitlementItem | null;
  contentFolderPath: string;
  assetFolderName: string;
  allEntitlements: EntitlementItem[];
  onSave: (item: EntitlementItem) => void;
  onClose: () => void;
}

export const EntitlementModal: React.FC<EntitlementModalProps> = ({
  isOpen,
  item,
  contentFolderPath,
  assetFolderName,
  allEntitlements,
  onSave,
  onClose,
}) => {
  if (!isOpen || !item) return null;

  const [formData, setFormData] = useState<EntitlementItem>({ ...item });
  const [activeTab, setActiveTab] = useState<'general' | 'icon' | 'behavior' | 'hooks'>('general');

  // Handle price quick-select
  const setPrice = (amount: number) => {
    setFormData(prev => ({ ...prev, priceVBucks: Math.max(50, Math.min(5000, amount)) }));
  };

  // Auto-slugify key on name change if key hasn't been custom modified
  const handleNameChange = (newName: string) => {
    setFormData(prev => {
      const shouldAutoSlug = !prev.verseKey || prev.verseKey === sanitizeVerseIdentifier(prev.name);
      return {
        ...prev,
        name: newName,
        verseKey: shouldAutoSlug ? sanitizeVerseIdentifier(newName) : prev.verseKey,
      };
    });
  };

  const validationIssues = validateEntitlement(formData, allEntitlements);
  const errors = validationIssues.filter(i => i.severity === 'error');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (errors.length > 0) {
      alert(`Please fix validation errors before saving:\n- ${errors.map(e => e.message).join('\n- ')}`);
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0d1326] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-modal flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 font-bold shadow-md shadow-cyan-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-base text-white">
                {item.id.includes('new') ? 'Create New Entitlement' : `Edit: ${formData.name || formData.verseKey}`}
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                {formData.verseKey ? `${formData.verseKey}_entitlement` : 'Define item details & parameters'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-[#090e1a] px-6 gap-1">
          <button
            onClick={() => setActiveTab('general')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'general'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>General & Pricing</span>
          </button>

          <button
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

          <button
            onClick={() => setActiveTab('hooks')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'hooks'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Triggers & Hooks</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* TAB 1: General & Pricing */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              
              {/* Display Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Display Title (Name) *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. ⭐ VIP Pass or +10 Strength Boost"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-cyan-400 font-medium"
                />
              </div>

              {/* Verse Identifier Symbol */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>Verse Identifier Key *</span>
                  <span className="text-[10px] text-slate-500 lowercase">letters, numbers, underscore only</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formData.verseKey}
                    onChange={(e) => setFormData(prev => ({ ...prev, verseKey: sanitizeVerseIdentifier(e.target.value) }))}
                    placeholder="e.g. vip_pass or strength_boost_10"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm font-mono text-cyan-300 focus:outline-none focus:border-cyan-400 font-semibold"
                  />
                </div>
              </div>

              {/* Descriptions */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Short Description (Storefront Popup)
                  </label>
                  <input
                    type="text"
                    value={formData.shortDescription}
                    onChange={(e) => setFormData(prev => ({ ...prev, shortDescription: e.target.value }))}
                    placeholder="e.g. Unlock exclusive VIP conveyors & badge!"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Full Description
                  </label>
                  <textarea
                    rows={2}
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Detailed explanation of the entitlement and its in-game effects..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              {/* V-Bucks Price Configuration */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-sky-400" />
                    <span>Price in V-Bucks (50 – 5,000 VB, Step 50)</span>
                  </label>
                  <span className="font-mono text-base font-extrabold text-sky-400">
                    {formData.priceVBucks} VB
                  </span>
                </div>

                {/* Price input & slider */}
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    step={50}
                    value={formData.priceVBucks}
                    onChange={(e) => setFormData(prev => ({ ...prev, priceVBucks: parseInt(e.target.value, 10) || 50 }))}
                    className="w-32 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-sky-400 text-center"
                  />
                  <input
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
            </div>
          )}

          {/* TAB 2: Icon & Texture */}
          {activeTab === 'icon' && (
            <div className="space-y-4">
              <ImageUploadZone
                contentFolderPath={contentFolderPath}
                assetFolderName={assetFolderName}
                assetName={formData.verseKey || 'icon'}
                currentTextureRef={formData.iconTexture}
                currentImageData={formData.iconImageData}
                onTextureRefChange={(ref) => setFormData(prev => ({ ...prev, iconTexture: ref }))}
                onImageDataChange={(base64, fileName) => setFormData(prev => ({ ...prev, iconImageData: base64, iconFileName: fileName }))}
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
                  <div
                    onClick={() => setFormData(prev => ({ ...prev, itemType: 'durable', maxCount: 1, autoConsume: false }))}
                    className={`cursor-pointer border rounded-2xl p-3.5 transition-all flex flex-col justify-between ${
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
                  </div>

                  {/* Consumable */}
                  <div
                    onClick={() => setFormData(prev => ({ ...prev, itemType: 'consumable' }))}
                    className={`cursor-pointer border rounded-2xl p-3.5 transition-all flex flex-col justify-between ${
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
                  </div>
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
                      max={1000}
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
                        <span>Paid Random Item (Loot Box / Mystery Pull)</span>
                      </span>
                    </label>
                  </div>
                  {formData.flags.paidRandomItem && (
                    <div className="pt-2 border-t border-slate-800">
                      <label className="block text-[11px] font-medium text-rose-300 mb-1">
                        Odds Disclosure (Required by Epic Games Moderation) *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.flags.paidRandomItemOdds}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          flags: { ...prev.flags, paidRandomItemOdds: e.target.value },
                        }))}
                        placeholder="e.g. Common: 60%, Rare: 30%, Legendary: 10%"
                        className="w-full bg-slate-950 border border-rose-500/40 rounded-lg px-3 py-1.5 text-xs text-white"
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
              
              {/* Action Hook on Success */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                <label className="block text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>On Purchase Success Action</span>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { type: 'signal_event', label: 'Signal Custom Verse Event' },
                    { type: 'device_method', label: 'Call Device / Save Manager' },
                    { type: 'custom_verse', label: 'Custom Verse Code Snippet' },
                  ].map(option => (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        actionHook: { ...prev.actionHook, type: option.type as ActionHookType },
                      }))}
                      className={`px-3 py-2 text-xs font-semibold rounded-xl border text-left transition-all ${
                        formData.actionHook.type === option.type
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {formData.actionHook.type === 'signal_event' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Custom Event Symbol</label>
                    <input
                      type="text"
                      value={formData.actionHook.eventName || `${formData.verseKey}_PurchasedEvent`}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        actionHook: { ...prev.actionHook, eventName: e.target.value },
                      }))}
                      placeholder="e.g. VipPassPurchasedEvent"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-emerald-300"
                    />
                  </div>
                )}

                {formData.actionHook.type === 'device_method' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Device Call (e.g. SaveManager)</label>
                    <input
                      type="text"
                      value={formData.actionHook.targetDevice || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        actionHook: { ...prev.actionHook, targetDevice: e.target.value },
                      }))}
                      placeholder="e.g. SaveManager.GrantDoubleMoney(Player)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-emerald-300"
                    />
                  </div>
                )}

                {formData.actionHook.type === 'custom_verse' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Verse Code Snippet</label>
                    <textarea
                      rows={3}
                      value={formData.actionHook.customVerseCode || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        actionHook: { ...prev.actionHook, customVerseCode: e.target.value },
                      }))}
                      placeholder="# Write custom logic here&#10;MyManager.HandlePurchase(Player, QuantityBought)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-emerald-300"
                    />
                  </div>
                )}
              </div>

              {/* Triggers (Buttons & Mutator Zones) */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                <label className="block text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  <span>In-Game Triggers & Bindings</span>
                </label>

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
                  <span className={issue.severity === 'error' ? 'text-rose-300 font-medium' : 'text-amber-300'}>
                    {issue.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Modal Footer Controls */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
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
              <span>Save Entitlement</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
