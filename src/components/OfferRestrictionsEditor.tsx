import React, { useMemo, useState } from 'react';
import { ChevronDown, Cloud, Gamepad2, Monitor, Plus, Search, Smartphone, X } from 'lucide-react';
import { COUNTRY_CODE_OPTIONS, COUNTRY_PICKER_OPTIONS, EPIC_PLATFORM_FAMILIES, getCountryName } from '../constants/offerRestrictions';
import { OfferRestrictions } from '../types/entitlement';

interface OfferRestrictionsEditorProps {
  restrictions: OfferRestrictions;
  onChange: (restrictions: OfferRestrictions) => void;
  compact?: boolean;
}

const Flag: React.FC<{ code: string }> = ({ code }) => {
  const index = COUNTRY_CODE_OPTIONS.indexOf(code.toUpperCase());
  const column = index % 16;
  const row = Math.floor(index / 16);
  // The source sprite is 2x and has a one-CSS-pixel gutter around each tile.
  // Offset into the tile after its gutter so the 24x18 viewport never samples
  // a neighbouring country, including on high-DPI displays.
  const cellWidth = 26;
  const cellHeight = 20;
  const gutter = 1;
  return <span className="h-[18px] w-6 shrink-0 rounded-sm border border-white/10 bg-no-repeat shadow-sm" style={{ backgroundImage: 'url(/flag-sprite.webp)', backgroundPosition: `${-(column * cellWidth + gutter)}px ${-(row * cellHeight + gutter)}px`, backgroundSize: `${16 * cellWidth}px ${Math.ceil(COUNTRY_CODE_OPTIONS.length / 16) * cellHeight}px` }} aria-hidden="true" />;
};

const PlatformIcon: React.FC<{ platform: string }> = ({ platform }) => {
  const Icon = platform === 'Android' || platform === 'iOS' ? Smartphone
    : platform === 'Windows' || platform === 'macOS' ? Monitor
      : platform === 'Luna' || platform === 'GeForceNow' ? Cloud
        : Gamepad2;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />;
};

export const OfferRestrictionsEditor: React.FC<OfferRestrictionsEditorProps> = ({ restrictions, onChange, compact = false }) => {
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const selectedCodes = restrictions.blockedCountryCodes ?? [];
  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    return COUNTRY_PICKER_OPTIONS.filter(country => !selectedCodes.includes(country.code) && (!query || country.name.toLowerCase().includes(query) || country.code.toLowerCase().includes(query)));
  }, [countrySearch, selectedCodes]);
  const update = (patch: Partial<OfferRestrictions>) => onChange({ ...restrictions, ...patch });
  const togglePlatform = (platform: string) => {
    const platforms = restrictions.blockedPlatformFamilies.includes(platform)
      ? restrictions.blockedPlatformFamilies.filter(candidate => candidate !== platform)
      : [...restrictions.blockedPlatformFamilies, platform];
    update({ blockedPlatformFamilies: platforms });
  };
  const addCountry = (code: string) => {
    update({ blockedCountryCodes: [...selectedCodes, code] });
    setCountrySearch('');
  };
  const removeCountry = (code: string) => update({ blockedCountryCodes: selectedCodes.filter(candidate => candidate !== code) });

  return (
    <div className={`space-y-3 ${compact ? 'rounded-xl border border-slate-800 bg-slate-950/40 p-3' : ''}`}>
      {!compact && <div><p className="text-xs font-bold text-cyan-300 uppercase tracking-wider">Offer restrictions</p><p className="text-[11px] text-slate-400">Epic receives the country and platform values anonymously when validating the offer. Platform IDs are limited to the official Marketplace values.</p></div>}
      <label className="block text-xs text-slate-300">Minimum purchase age
        <input type="number" min={0} max={99} value={restrictions.minimumPurchaseAge ?? ''} onChange={event => update({ minimumPurchaseAge: event.target.value === '' ? undefined : Number(event.target.value) })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2" placeholder="No additional age gate" />
      </label>
      <div>
        <p className="text-xs text-slate-300 mb-1">Blocked platform families</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {EPIC_PLATFORM_FAMILIES.map(platform => <label key={platform} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-300"><input type="checkbox" checked={restrictions.blockedPlatformFamilies.includes(platform)} onChange={() => togglePlatform(platform)} className="accent-cyan-500" /><PlatformIcon platform={platform} /><span>{platform}</span></label>)}
        </div>
      </div>
      <div className="relative">
        <p className="text-xs text-slate-300 mb-1">Blocked countries</p>
        <button type="button" onClick={() => setCountryPickerOpen(open => !open)} aria-expanded={countryPickerOpen} className="w-full flex items-center justify-between bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 hover:border-cyan-400"><span className="flex items-center gap-2"><Search className="w-3.5 h-3.5" />Choose countries by name or ISO code</span><ChevronDown className="w-3.5 h-3.5" /></button>
        {selectedCodes.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{selectedCodes.map(code => <span key={code} className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200"><Flag code={code} /><span>{getCountryName(code)}</span><span className="font-mono text-[10px] text-rose-300/70">{code}</span><button type="button" aria-label={`Remove ${getCountryName(code)}`} onClick={() => removeCountry(code)} className="text-rose-300 hover:text-white"><X className="w-3 h-3" /></button></span>)}</div>}
        {countryPickerOpen && <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-slate-700 bg-[#0d1326] p-2 shadow-2xl"><input autoFocus value={countrySearch} onChange={event => setCountrySearch(event.target.value)} placeholder={'e.g. "United States" or "US"'} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400" /><div className="mt-2 max-h-56 overflow-y-auto space-y-0.5">{filteredCountries.length > 0 ? filteredCountries.map(country => <button key={country.code} type="button" onClick={() => addCountry(country.code)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-cyan-500/10"><Flag code={country.code} /><span className="flex-1">{country.name}</span><span className="font-mono text-[10px] text-slate-500">{country.code}</span><Plus className="w-3 h-3 text-cyan-300" aria-hidden="true" /></button>) : <p className="px-2 py-3 text-xs text-slate-500">No matching countries.</p>}</div></div>}
      </div>
    </div>
  );
};
