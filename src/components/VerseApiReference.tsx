import React, { useEffect, useMemo, useState } from 'react';
import { copyText } from '../services/clipboard';
import { Copy, Search } from 'lucide-react';
import type { BundleOffer, EntitlementItem, ProjectConfig, StorefrontMembership } from '../types/entitlement';
import { createVerseApiReference, type ApiReferenceItem } from '../services/verseApiReference';

export const CopyCode: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copy' }) => {
  const [result, setResult] = useState('');
  useEffect(() => { setResult(''); }, [text]);
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(''), 4000);
    return () => window.clearTimeout(timer);
  }, [result]);
  return <button type="button" aria-label={label} onClick={async () => { try { await copyText(text); setResult('Copied'); } catch { setResult('Copy failed'); } }} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-cyan-200"><Copy className="h-3.5 w-3.5" /><span role="status">{result || 'Copy'}</span></button>;
};

const ReferenceDetails: React.FC<{ item: ApiReferenceItem; config: ProjectConfig }> = ({ item, config }) => {
  const [section, setSection] = useState('Functions');
  const [eventMode, setEventMode] = useState<'callbacks' | 'await'>('callbacks');
  const sections = ['Functions', ...(item.events.length ? ['Events'] : []), 'Device wiring', ...(item.example ? ['Example'] : [])];
  return <article data-api-item={item.id} className="min-w-0 space-y-4">
    <header>
      <p className="text-xs font-semibold text-cyan-300">{item.kind}</p>
      <h3 className="mt-1 break-words text-xl font-bold text-white">{item.name}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.description}</p>
    </header>
    <nav aria-label="Reference sections" className="flex flex-wrap gap-1 border-b border-slate-800 pb-3">
      {sections.map(label => <button type="button" key={label} aria-pressed={section === label} onClick={() => setSection(label)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${section === label ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{label}</button>)}
    </nav>
    {section === 'Functions' && <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-400">Call these on the placed <code className="text-slate-200">Transactions</code> device. Functions marked <strong>Suspends</strong> need a suspending Verse context.</p>
      {item.runtime && <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4">
        <h4 className="text-sm font-semibold text-cyan-200">Runtime options required</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Calculate these values in your own Verse and pass them as <code>Options</code> when opening the purchase.</p>
        <code className="mt-2 block break-all text-xs text-cyan-100">{item.runtime.type}</code>
        <ul className="mt-2 space-y-1 text-xs text-slate-300">{item.runtime.fields.map(field => <li key={field}><code>{field}:{field === 'PriceVBucks' ? 'float' : 'int'}</code><span className="text-slate-400"> — {field === 'PriceVBucks' ? 'the price for this purchase' : 'the quantity for this bundle entry'}</span></li>)}</ul>
      </div>}
      {item.functions.map(fn => <section key={fn.symbol} aria-label={fn.title} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-white">{fn.title}</h4>{fn.suspends && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-200">Suspends</span>}</div><CopyCode text={fn.call} label={`Copy ${fn.symbol} call`} /></div>
        <code className="mt-2 block break-all rounded-lg bg-[#080d19] px-3 py-2 font-mono text-[13px] leading-5 text-emerald-200">{fn.call}</code>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{fn.description}</p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-slate-500">Inputs</dt><dd className="mt-0.5 text-slate-300">{fn.inputs}</dd></div><div><dt className="text-slate-500">Returns</dt><dd className="mt-0.5 text-slate-300">{fn.returns}</dd></div></dl>
      </section>)}
    </div>}
    {section === 'Events' && <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-400">Payload: <code>tuple(player, int)</code> — the player and quantity.</p><div className="flex gap-1 rounded-lg bg-slate-950 p-1">{(['callbacks', 'await'] as const).map(mode => <button key={mode} type="button" aria-pressed={eventMode === mode} onClick={() => setEventMode(mode)} className={`rounded px-2 py-1 text-xs ${eventMode === mode ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>{mode === 'callbacks' ? 'Callbacks' : 'Await functions'}</button>)}</div></div>
      {item.events.map(event => {
        const call = eventMode === 'callbacks' ? `Transactions.${event.subscribe}(YourCallback)` : `Transactions.${event.await}()`;
        return <section key={event.name} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-white">{event.name}</h4><CopyCode text={call} label={`Copy ${eventMode === 'callbacks' ? event.subscribe : event.await} call`} /></div><p className="mt-1 text-[13px] leading-relaxed text-slate-400">{event.description}</p><code className="mt-3 block break-all rounded-lg bg-[#080d19] px-3 py-2 text-[13px] leading-5 text-emerald-200">{call}</code><p className="mt-2 text-xs text-slate-500">{eventMode === 'callbacks' ? 'Returns a UTM subscription handle. Call Cancel() to stop listening. YourCallback must accept the payload and must not suspend.' : 'Suspends until the next notification and returns the payload. Use a loop to keep listening.'}</p></section>;
      })}
      <p className="rounded-xl bg-slate-800/40 p-3 text-xs leading-relaxed text-slate-400">{item.note}</p>
    </div>}
    {section === 'Device wiring' && <div className="space-y-3"><p className="text-sm leading-relaxed text-slate-400">Select the placed <code className="text-slate-200">{config.deviceClassName}</code> in UEFN. Assign devices to these arrays in Details.</p>{item.wiring.length ? item.wiring.map(field => <section key={field.symbol} className="rounded-xl border border-slate-800 p-4"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-white">{field.label}</h4><CopyCode text={field.symbol} label={`Copy ${field.symbol} field`} /></div><code className="mt-2 block break-all text-[13px] text-cyan-200">{field.symbol}</code><p className="mt-2 text-[13px] leading-relaxed text-slate-400">{field.description}</p></section>) : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">No device arrays are enabled for this item. Use its Verse functions.{['Consumable', 'Durable'].includes(item.kind) && ' You can also enable supported bindings in the item’s Advanced settings.'}</p>}</div>}
    {section === 'Example' && item.example && <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-white">Listen from your own Verse device</h4><CopyCode text={item.example} label="Copy callback example" /></div><p className="text-[13px] leading-relaxed text-slate-400">Assign the placed manager to <code>Transactions</code> in your gameplay device’s Details. Choose other notifications from the Events tab.</p><pre className="overflow-x-auto rounded-xl border border-slate-800 bg-[#080d19] p-4 text-[13px] leading-6 text-emerald-200">{item.example}</pre><p className="text-xs leading-relaxed text-slate-400">{item.note}</p></div>}
    <details className="border-t border-slate-800 pt-3 text-xs text-slate-500"><summary className="cursor-pointer">Generated identity</summary><p className="mt-2 break-all">Catalog key: <code>{item.key}</code></p><p className="mt-1 break-all">Device: <code>{config.deviceClassName}</code></p></details>
  </article>;
};

export const VerseApiReference: React.FC<{ config: ProjectConfig; entitlements: EntitlementItem[]; bundles: BundleOffer[]; storefrontMembership: StorefrontMembership; selectedId: string | null; onSelect: (id: string) => void }> = ({ config, entitlements, bundles, storefrontMembership, selectedId, onSelect }) => {
  const [query, setQuery] = useState('');
  const entries = useMemo(() => createVerseApiReference(config, entitlements, bundles, storefrontMembership), [config, entitlements, bundles, storefrontMembership]);
  const filtered = entries.filter(item => `${item.name} ${item.key} ${item.kind} ${item.functions.map(fn => fn.symbol).join(' ')} ${item.events.map(event => `${event.subscribe} ${event.await}`).join(' ')} ${item.wiring.map(field => field.symbol).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0];
  return <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
    <aside className="min-w-0 lg:sticky lg:top-0">
      <label className="relative block"><span className="sr-only">Search Verse API</span><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an item or function…" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-xs text-white outline-none focus:border-cyan-400" /></label>
      <nav aria-label="API reference items" className="mt-3 max-h-40 space-y-1 overflow-y-auto pr-1 lg:max-h-[52vh]">{filtered.map(item => <button key={item.id} type="button" aria-current={selected?.id === item.id ? 'true' : undefined} onClick={() => onSelect(item.id)} className={`block w-full rounded-lg border px-3 py-2.5 text-left ${selected?.id === item.id ? 'border-cyan-400/30 bg-cyan-500/10' : 'border-transparent hover:bg-slate-800/60'}`}><span className={`block break-words text-sm font-semibold ${selected?.id === item.id ? 'text-cyan-100' : 'text-slate-300'}`}>{item.name}</span><span className="mt-0.5 block text-[11px] text-slate-500">{item.kind}</span></button>)}</nav>
      {!filtered.length && <p className="py-4 text-sm text-slate-400">No matching items or functions.</p>}
    </aside>
    {selected ? <ReferenceDetails key={selected.id} item={selected} config={config} /> : <p className="p-4 text-sm text-slate-400">Try another name, catalog key, or function.</p>}
  </div>;
};
