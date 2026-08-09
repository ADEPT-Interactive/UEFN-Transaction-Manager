import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Sparkles, 
  Layers, 
  Infinity as InfinityIcon, 
  RotateCw, 
  Coins, 
  Lock, 
  Dice5,
  LayoutGrid,
  List as ListIcon,
  HelpCircle
} from 'lucide-react';
import { EntitlementItem, BundleOffer } from '../types/entitlement';
import { EntitlementCard } from './EntitlementCard';

interface EntitlementListProps {
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  onAddNew: () => void;
  onAddPreset: (presetIndex: number) => void;
  onEdit: (item: EntitlementItem) => void;
  onDuplicate: (item: EntitlementItem) => void;
  onDelete: (id: string) => void;
  onTestPurchase: (item: EntitlementItem) => void;
}

export const EntitlementList: React.FC<EntitlementListProps> = ({
  entitlements,
  bundles,
  onAddNew,
  onAddPreset,
  onEdit,
  onDuplicate,
  onDelete,
  onTestPurchase,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'durable' | 'consumable' | 'paidArea' | 'paidRandom'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Compute catalog stats
  const totalItems = entitlements.length;
  const durableCount = entitlements.filter(e => e.itemType === 'durable').length;
  const consumableCount = entitlements.filter(e => e.itemType === 'consumable').length;
  const totalCatalogVBucks = entitlements.reduce((sum, e) => sum + (e.priceVBucks || 0), 0);
  const paidAreaCount = entitlements.filter(e => e.flags.paidArea).length;
  const paidRandomCount = entitlements.filter(e => e.flags.paidRandomItem).length;

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
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Items</p>
            <p className="text-xl font-extrabold text-white mt-0.5 font-mono">{totalItems}</p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        {/* Durables */}
        <div className="bg-[#0f1629]/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Durables (Permanent)</p>
            <p className="text-xl font-extrabold text-purple-400 mt-0.5 font-mono">{durableCount}</p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <InfinityIcon className="w-4 h-4" />
          </div>
        </div>

        {/* Consumables */}
        <div className="bg-[#0f1629]/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Consumables</p>
            <p className="text-xl font-extrabold text-amber-400 mt-0.5 font-mono">{consumableCount}</p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <RotateCw className="w-4 h-4" />
          </div>
        </div>

        {/* Total Catalog V-Bucks */}
        <div className="bg-[#0f1629]/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Catalog Value</p>
            <p className="text-xl font-extrabold text-sky-400 mt-0.5 font-mono">{totalCatalogVBucks.toLocaleString()} <span className="text-xs font-bold text-sky-300">VB</span></p>
          </div>
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-400">
            <Coins className="w-4 h-4" />
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
            placeholder="Search entitlements by title, key, or description..."
            className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors font-medium"
          />
        </div>

        {/* Filter Chips & Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          
          {/* Category Filter Chips */}
          <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'all' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({totalItems})
            </button>
            <button
              onClick={() => setFilterType('durable')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'durable' ? 'bg-purple-500/20 text-purple-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Durables
            </button>
            <button
              onClick={() => setFilterType('consumable')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'consumable' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Consumables
            </button>
            <button
              onClick={() => setFilterType('paidArea')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'paidArea' ? 'bg-blue-500/20 text-blue-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paid Area
            </button>
            <button
              onClick={() => setFilterType('paidRandom')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'paidRandom' ? 'bg-rose-500/20 text-rose-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Loot/Random
            </button>
          </div>

          {/* Add Entitlement Button */}
          <button
            onClick={onAddNew}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all active:scale-95 ml-auto sm:ml-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Entitlement</span>
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
              onTestPurchase={onTestPurchase}
            />
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="bg-[#0f1629]/40 border border-dashed border-slate-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4">
            <Sparkles className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white">No Entitlements Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            {searchQuery
              ? `No items match your search "${searchQuery}". Try clearing the search query.`
              : 'Your project currently has no configured entitlements. Create your first item or load from default presets.'}
          </p>
          
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={onAddNew}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Entitlement</span>
            </button>
            <button
              onClick={() => onAddPreset(0)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
            >
              <span>Load VIP Pass Preset</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
