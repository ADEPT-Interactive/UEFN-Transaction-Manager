import React, { useEffect, useMemo, useState } from 'react';
import { 
  Plus, 
  Search, 
  Sparkles, 
  Layers, 
  Infinity as InfinityIcon, 
  RotateCw, 
  FilePlus2,
  WandSparkles,
  X,
  ChevronDown,
} from 'lucide-react';
import { BundleOffer, EntitlementItem } from '../types/entitlement';
import { DEFAULT_PRESETS } from '../constants/presets';
import { EntitlementCard } from './EntitlementCard';
import { VBucksIcon } from './VBucksIcon';

interface EntitlementListProps {
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  onAddNew: () => void;
  onAddPreset: (presetIndex: number) => void;
  onEdit: (item: EntitlementItem) => void;
  onDuplicate: (item: EntitlementItem) => void;
  onDelete: (id: string) => void;
  creationRequest?: number;
}

export const EntitlementList: React.FC<EntitlementListProps> = ({
  entitlements,
  bundles,
  onAddNew,
  onAddPreset,
  onEdit,
  onDuplicate,
  onDelete,
  creationRequest = 0,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'durable' | 'consumable' | 'paidArea' | 'paidRandom'>('all');
  const [isCreationMenuOpen, setIsCreationMenuOpen] = useState(false);
  useEffect(() => {
    if (creationRequest > 0) setIsCreationMenuOpen(true);
  }, [creationRequest]);

  // Compute catalog stats
  const totalItems = entitlements.length;
  const durableCount = entitlements.filter(e => e.itemType === 'durable').length;
  const consumableCount = entitlements.filter(e => e.itemType === 'consumable').length;
  const totalOfferVBucks = entitlements.reduce((sum, entitlement) => sum + entitlement.priceVBucks + (entitlement.alternateOffers ?? []).reduce((offerSum, offer) => offerSum + offer.priceVBucks, 0), 0)
    + bundles.reduce((sum, bundle) => sum + bundle.priceVBucks, 0);
  const paidAreaCount = entitlements.filter(e => e.flags.paidArea).length;
  const paidRandomCount = entitlements.filter(e => e.flags.paidRandomItem).length;
  const filterLabel = filterType === 'all' ? 'Offers' : filterType === 'paidArea' ? 'Paid Area Offers' : filterType === 'paidRandom' ? 'Random Offers' : `${filterType[0].toUpperCase()}${filterType.slice(1)} Offers`;

  // Filtered entitlements
  const filteredItems = useMemo(() => {
    return entitlements.filter(item => {
      // Search match
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        item.name.toLowerCase().includes(q) ||
        item.verseKey.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      // Filter category match
      if (filterType === 'durable') return item.itemType === 'durable';
      if (filterType === 'consumable') return item.itemType === 'consumable';
      if (filterType === 'paidArea') return item.flags.paidArea;
      if (filterType === 'paidRandom') return item.flags.paidRandomItem;

      return true;
    });
  }, [entitlements, searchQuery, filterType]);

  return (
    <div className="space-y-6">
      
      {/* Top Metrics Cards Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        
        {/* Total Catalog Items */}
        <div className="bg-[#0f1629]/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Entitlements</p>
            <p className="text-xl font-extrabold text-white mt-0.5 font-mono">{totalItems}</p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        {/* Durables */}
        <div className="bg-[#0f1629]/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Durables (Permanent)</p>
            <p className="text-xl font-extrabold text-purple-400 mt-0.5 font-mono">{durableCount}</p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <InfinityIcon className="w-4 h-4" />
          </div>
        </div>

        {/* Consumables */}
        <div className="bg-[#0f1629]/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Consumables</p>
            <p className="text-xl font-extrabold text-amber-400 mt-0.5 font-mono">{consumableCount}</p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <RotateCw className="w-4 h-4" />
          </div>
        </div>

        {/* Total Catalog V-Bucks */}
        <div className="bg-[#0f1629]/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">All Offer Value</p>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xl font-extrabold text-sky-400"><VBucksIcon className="h-5 w-5" /><span>{totalOfferVBucks.toLocaleString()}</span><span className="text-xs font-bold text-sky-300">V-Bucks</span></p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-400">
            <VBucksIcon className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* Control Bar: Search, Filters & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0f1629]/60 p-3 rounded-2xl border border-slate-800/80">
        
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search offers by title, key, or description..."
            className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors font-medium"
          />
        </div>

        {/* Filter Chips & Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          
          {/* Category Filter Chips */}
          <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'all' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({totalItems})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('durable')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'durable' ? 'bg-purple-500/20 text-purple-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Durables
            </button>
            <button
              type="button"
              onClick={() => setFilterType('consumable')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'consumable' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Consumables
            </button>
            <button
              type="button"
              onClick={() => setFilterType('paidArea')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'paidArea' ? 'bg-blue-500/20 text-blue-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paid Area
            </button>
            <button
              type="button"
              onClick={() => setFilterType('paidRandom')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'paidRandom' ? 'bg-rose-500/20 text-rose-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Random
            </button>
          </div>

          {/* Add Entitlement Button */}
          <button
            type="button"
            onClick={() => setIsCreationMenuOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all active:scale-95 ml-auto sm:ml-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create Offer</span>
          </button>
        </div>
      </div>

      {/* Entitlements Grid / List View */}
      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map(item => (
            <EntitlementCard
              key={item.id}
              item={item}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="bg-[#0f1629]/40 border border-dashed border-slate-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4">
            <Sparkles className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white">No {filterLabel} Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            {searchQuery
              ? `No ${filterType === 'all' ? 'offers' : filterLabel.toLowerCase()} match your search "${searchQuery}". Try clearing the search or choosing another tab.`
              : filterType === 'all' ? 'Your project currently has no configured offers. Create one from scratch or choose a clearly labeled category.' : `Your project has no ${filterLabel.toLowerCase()} in this category. Choose another tab or create an offer.`}
          </p>
          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              onClick={() => setIsCreationMenuOpen(true)}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create Offer</span>
            </button>
          </div>
        </div>
      )}
      {isCreationMenuOpen && <CreationChooser onClose={() => setIsCreationMenuOpen(false)} onScratch={() => { setIsCreationMenuOpen(false); onAddNew(); }} onPreset={index => { setIsCreationMenuOpen(false); onAddPreset(index); }} />}
    </div>
  );
};

const CreationChooser: React.FC<{ onClose: () => void; onScratch: () => void; onPreset: (index: number) => void }> = ({ onClose, onScratch, onPreset }) => {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  return (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="creation-chooser-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700 bg-[#0d1326] p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-cyan-300">Create an offer</p><h2 id="creation-chooser-title" className="mt-1 text-xl font-extrabold text-white">Choose a starting category</h2><p className="mt-1 text-xs text-slate-400">Categories set up manager fields only. Connect the actual gameplay behavior in your own Verse or device logic.</p></div><button type="button" aria-label="Close creation chooser" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="w-5 h-5" /></button></div>
      <div className="mt-5 space-y-3">
        <button type="button" onClick={onScratch} className="flex w-full items-center justify-between gap-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-left transition hover:border-cyan-300 hover:bg-cyan-500/15"><div className="flex min-w-0 items-center gap-3"><FilePlus2 className="h-5 w-5 shrink-0 text-cyan-300" /><div className="min-w-0"><span className="block whitespace-nowrap text-sm font-bold text-cyan-200">Start from scratch</span><span className="block text-[11px] text-slate-400">Create a blank offer with no category-specific settings.</span></div></div><span className="shrink-0 text-xs font-bold text-cyan-300">Create</span></button>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4"><div className="flex items-center gap-2 text-slate-200"><WandSparkles className="h-5 w-5 text-cyan-300" /><span className="text-sm font-bold">Start with a template</span></div><div className="mt-3 space-y-2">{DEFAULT_PRESETS.map((preset, index) => { const selected = selectedPreset === index; return <div key={`${preset.verseKey}-${index}`} className={`overflow-hidden rounded-xl border bg-slate-950/70 transition ${selected ? 'border-cyan-500/60' : 'border-slate-800 hover:border-slate-700'}`}><button type="button" aria-expanded={selected} onClick={() => setSelectedPreset(selected ? null : index)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"><span className="min-w-0 whitespace-nowrap text-xs font-bold text-white">{preset.presetTitle}</span><ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${selected ? 'rotate-180 text-cyan-300' : ''}`} /></button>{selected && <div className="border-t border-slate-800 px-3 pb-3 pt-2"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Configured</p><p className="mt-1 text-[11px] leading-4 text-slate-300">{preset.presetDescription}</p><p className="mt-2 text-[11px] text-slate-400"><span className="font-semibold text-cyan-300">Example:</span> {preset.presetExample}</p><button type="button" onClick={() => onPreset(index)} className="mt-3 w-full rounded-lg bg-cyan-400 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-cyan-300">Use this template</button></div>}</div>; })}</div></div>
      </div>
    </div>
  </div>
  );
};
