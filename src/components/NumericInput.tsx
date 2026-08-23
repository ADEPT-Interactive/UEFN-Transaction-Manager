import React from 'react';

interface NumericInputBase {
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

type NumericInputProps = NumericInputBase & ({
  value: number;
  onChange: (value: number) => void;
  allowEmpty?: false;
} | {
  value: number | '';
  onChange: (value: number | '') => void;
  allowEmpty: true;
});

function clamp(value: number, min?: number, max?: number): number {
  if (!Number.isFinite(value)) return min ?? 0;
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  id,
  ariaLabel,
  className = '',
  disabled = false,
  allowEmpty = false,
}) => {
  const numericValue = typeof value === 'number' ? value : (min ?? 0);
  const changeBy = (direction: -1 | 1) => onChange(clamp(numericValue + step * direction, min, max));

  return (
    <span className={`inline-flex min-w-0 items-stretch overflow-hidden rounded-lg border border-slate-700 bg-slate-950 ${disabled ? 'opacity-50' : ''}`}>
      <button type="button" aria-label={`Decrease ${ariaLabel}`} disabled={disabled || (min !== undefined && numericValue <= min)} onClick={() => changeBy(-1)} className="w-7 shrink-0 border-r border-slate-800 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">−</button>
      <input
        id={id}
        aria-label={ariaLabel}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={event => {
          if (allowEmpty && event.target.value === '') (onChange as (next: number | '') => void)('');
          else onChange(clamp(Number(event.target.value), min, max));
        }}
        className={`utm-number-input min-w-0 flex-1 bg-transparent px-2 py-2 text-center font-mono text-sm font-bold text-white outline-none focus:bg-slate-900 ${className}`}
      />
      <button type="button" aria-label={`Increase ${ariaLabel}`} disabled={disabled || (max !== undefined && numericValue >= max)} onClick={() => changeBy(1)} className="w-7 shrink-0 border-l border-slate-800 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">+</button>
    </span>
  );
};
