import React from 'react';
import { MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';
import { VBucksIcon } from './VBucksIcon';
import { NumericInput } from './NumericInput';

interface VBucksPriceControlProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  compact?: boolean;
}

const PRICE_PRESETS = [50, 100, 150, 200, 400, 500, 1000, 2000, 5000];

/** Shared fixed-price editor used by primary offers, variants, and bundles. */
export const VBucksPriceControl: React.FC<VBucksPriceControlProps> = ({
  id,
  value,
  onChange,
  ariaLabel = 'Offer price in V-Bucks',
  compact = false,
}) => {
  const presets = [...new Set(PRICE_PRESETS)].filter(amount => amount >= MARKETPLACE_CONSTRAINTS.priceMinVBucks && amount <= MARKETPLACE_CONSTRAINTS.priceMaxVBucks);
  const title = ariaLabel.replace(/\s+in V-Bucks$/i, '');
  return (
    <div className={compact ? 'space-y-2' : 'bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3'} data-vbucks-price-control="true">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
          <VBucksIcon className="h-4 w-4 text-sky-400" />
          <span>{title} ({MARKETPLACE_CONSTRAINTS.priceMinVBucks.toLocaleString()} to {MARKETPLACE_CONSTRAINTS.priceMaxVBucks.toLocaleString()} VB, increments of {MARKETPLACE_CONSTRAINTS.priceStepVBucks})</span>
        </label>
        <span className="font-mono text-base font-extrabold text-sky-400" aria-label={`${value.toLocaleString()} V-Bucks`}>
          <span className="inline-flex items-center gap-1.5"><VBucksIcon className="h-4 w-4" />{value.toLocaleString()}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <NumericInput
          id={id}
          value={value}
          min={MARKETPLACE_CONSTRAINTS.priceMinVBucks}
          max={MARKETPLACE_CONSTRAINTS.priceMaxVBucks}
          step={MARKETPLACE_CONSTRAINTS.priceStepVBucks}
          ariaLabel={ariaLabel}
          onChange={onChange}
          className="w-16"
        />
        <input
          id={`${id}-slider`}
          aria-label={`${ariaLabel} slider`}
          type="range"
          min={MARKETPLACE_CONSTRAINTS.priceMinVBucks}
          max={MARKETPLACE_CONSTRAINTS.priceMaxVBucks}
          step={MARKETPLACE_CONSTRAINTS.priceStepVBucks}
          value={value}
          onChange={event => onChange(Number.parseInt(event.target.value, 10))}
          className="flex-1 accent-sky-400 h-2 bg-slate-800 rounded-lg cursor-pointer"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1" aria-label={`${ariaLabel} presets`}>
        {presets.map(amount => (
          <button
            key={amount}
            type="button"
            data-vbucks-price-preset={amount}
            onClick={() => onChange(amount)}
            className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border transition-all ${value === amount ? 'bg-sky-500 text-slate-950 border-sky-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
          >
            {amount.toLocaleString()}
          </button>
        ))}
      </div>
    </div>
  );
};
