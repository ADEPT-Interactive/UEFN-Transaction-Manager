import React from 'react';
import { 
  Sparkles, 
  Infinity as InfinityIcon, 
  RotateCw, 
  Dice5, 
  Lock, 
  ShieldAlert, 
  Copy, 
  Trash2, 
  Edit3, 
  Layers
} from 'lucide-react';
import { EntitlementItem } from '../types/entitlement';
import { VBucksIcon } from './VBucksIcon';

interface EntitlementCardProps {
  item: EntitlementItem;
  onEdit: (item: EntitlementItem) => void;
  onDuplicate: (item: EntitlementItem) => void;
  onDelete: (id: string) => void;
}

export const EntitlementCard: React.FC<EntitlementCardProps> = ({
  item,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  const isConsumable = item.itemType === 'consumable';

  return (
    <div className="group relative bg-[#0f1629]/90 hover:bg-[#15203b] border border-slate-800 hover:border-cyan-500/40 rounded-2xl p-4 transition-all duration-200 shadow-md hover:shadow-xl hover:shadow-cyan-500/10 flex flex-col justify-between">
      
      {/* Top Header & Badges */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          
          {/* Icon Thumbnail */}
          <div className="relative w-14 h-14 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0 shadow-inner group-hover:scale-105 transition-transform">
            {item.iconImageData ? (
              <img 
                src={item.iconImageData} 
                alt={item.name} 
                className="w-full h-full object-contain p-1" 
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-500 group-hover:text-cyan-400 transition-colors">
                <Sparkles className="w-6 h-6" />
                <span className="text-[9px] font-mono mt-0.5 uppercase tracking-tighter">Icon</span>
              </div>
            )}
          </div>

          {/* V-Bucks Price Tag */}
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5 bg-gradient-to-r from-sky-500/20 to-blue-500/20 text-sky-300 border border-sky-400/40 px-2.5 py-1 rounded-full shadow-sm">
              <VBucksIcon className="h-3.5 w-3.5 animate-pulse-subtle text-sky-400" />
              <span className="font-extrabold text-xs font-mono">{item.priceVBucks.toLocaleString()}</span>
              <span className="text-[10px] text-sky-400 font-bold">V-Bucks</span>
            </div>
            
            <span className="text-[10px] font-mono text-slate-500 mt-1 truncate max-w-[120px]" title={item.iconTexture}>
              {item.iconTexture || 'No Icon Ref'}
            </span>
          </div>
        </div>

        {/* Title & Key */}
        <div>
          <h3 className="font-bold text-base text-white group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
            <span>{item.name}</span>
          </h3>
          <p className="font-mono text-xs text-slate-400 mt-0.5">
            Key: <span className="text-cyan-400/90 font-medium">{item.verseKey}</span>
          </p>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-300/90 mt-2 line-clamp-2 leading-relaxed">
          {item.shortDescription || item.description || 'No description provided.'}
        </p>

        {/* Badges Bar */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {/* Durable vs Consumable Badge */}
          {isConsumable ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-md">
              <RotateCw className="w-3 h-3" />
              <span>Consumable (Max {item.maxCount})</span>
              {item.autoConsume && <span className="text-[9px] text-amber-400 font-bold uppercase">• Auto-use</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-md">
              <InfinityIcon className="w-3 h-3" />
              <span>Durable (Permanent)</span>
            </span>
          )}

          {/* Paid Area Badge */}
          {item.flags.paidArea && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-md">
              <Lock className="w-3 h-3" />
              <span>Paid Area</span>
            </span>
          )}

          {/* Paid Random Item Badge */}
          {item.flags.paidRandomItem && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-md" title={item.flags.paidRandomItemOdds.trim() || 'No odds entered in UEM. Accurate numerical odds are still required before purchase.'}>
              <Dice5 className="w-3 h-3" />
              <span>Paid Random Item</span>
            </span>
          )}

          {/* Consequential Flag */}
          {item.flags.consequentialToGameplay && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded">
              Gameplay Stat
            </span>
          )}
        </div>
      </div>

      {/* Card Action Footer */}
      <div className="flex items-center justify-between border-t border-slate-800/80 pt-3 mt-4">
        

        {/* Quick Operations (Duplicate, Edit, Delete) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Duplicate ${item.name}`}
            onClick={() => onDuplicate(item)}
            title="Duplicate offer"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            aria-label={`Edit ${item.name}`}
            onClick={() => onEdit(item)}
            title="Edit offer"
            className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-md transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            aria-label={`Delete ${item.name}`}
            onClick={() => onDelete(item.id)}
            title="Delete offer"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
