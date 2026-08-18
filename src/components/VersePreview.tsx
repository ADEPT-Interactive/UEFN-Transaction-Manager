import React, { useState } from 'react';
import { 
  Copy, 
  Check, 
  Download, 
  Save, 
  FileCode, 
  ExternalLink 
} from 'lucide-react';
import { EntitlementItem, StorefrontMembership, ProjectConfig } from '../types/entitlement';
import { handleExternalLinkClick } from '../services/externalLink';
import { CREATING_ITEMS_AND_OFFERS_URL, IN_ISLAND_TRANSACTIONS_URL, TRANSACTION_BEST_PRACTICES_URL } from '../constants/docs';
import { SetupPanel } from './SetupPanel';

interface VersePreviewProps {
  verseCode: string;
  config: ProjectConfig;
  entitlements: EntitlementItem[];
  storefrontMembership: StorefrontMembership;
  onSaveToDisk: () => void;
  isSaving: boolean;
  hasErrors: boolean;
}

export const VersePreview: React.FC<VersePreviewProps> = ({
  verseCode,
  config,
  entitlements,
  storefrontMembership,
  onSaveToDisk,
  isSaving,
  hasErrors,
}) => {
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleCopy = () => {
    navigator.clipboard.writeText(verseCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([verseCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = config.targetVerseFileName || 'managed_transactions.verse';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Format lines for code block
  const lines = verseCode.split('\n');

  return (
    <div className="bg-[#0b0f19] border border-slate-800 rounded-2xl flex flex-col h-full overflow-hidden shadow-2xl">
      
      {/* Code Header Bar */}
      <div className="px-4 py-3 bg-[#0d1326] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-cyan-400" />
          <span className="font-mono text-xs font-bold text-white">
            {config.targetVerseFileName || 'managed_transactions.verse'}
          </span>
          <span className="text-[10px] font-mono text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded">
            {lines.length} lines
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          
          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>

          {/* Download File Button */}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>Download</span>
          </button>

          {/* Direct Write to Disk */}
          <button
            onClick={onSaveToDisk}
            disabled={isSaving || hasErrors}
            title={hasErrors ? 'Resolve validation errors before writing to the project.' : undefined}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all disabled:opacity-50 active:scale-95"
          >
            <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-bounce' : ''}`} />
            <span>{isSaving ? 'Writing to Disk...' : 'Write to Content/'}</span>
          </button>
        </div>
      </div>

      {/* Code Editor Body */}
      <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-[#070a13] text-slate-200 select-text">
        <div className="table w-full" role="region" aria-label="Generated Verse source">
          {lines.map((line, idx) => {
            const isComment = line.trim().startsWith('#');
            const isKeyword = line.includes(':=') || line.includes('<override>') || line.includes('<public>') || line.includes('module:');
            const isClass = line.includes('class(') || line.includes('class<');
            const isFunction = line.includes('()<') || line.includes(':void');

            return (
              <div 
                key={idx} 
                className={`table-row hover:bg-slate-800/40 transition-colors ${
                  searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase()) ? 'bg-cyan-500/10' : ''
                }`}
              >
                {/* Line Number */}
                <span className="table-cell pr-4 text-right select-none text-slate-600 w-12 font-mono text-[11px]">
                  {idx + 1}
                </span>

                {/* Line Text */}
                <span 
                  className={`table-cell whitespace-pre ${
                    isComment 
                      ? 'text-slate-500 italic' 
                      : isClass 
                      ? 'text-cyan-300 font-bold' 
                      : isKeyword 
                      ? 'text-indigo-300' 
                      : isFunction 
                      ? 'text-emerald-300' 
                      : 'text-slate-200'
                  }`}
                >
                  {line || ' '}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {entitlements.length > 0 && (
        <details open className="max-h-[48%] overflow-y-auto border-t border-slate-800 bg-[#0b1020] text-xs text-slate-300">
          <summary className="cursor-pointer px-4 py-3 font-bold text-cyan-300 hover:bg-slate-800/40">
            Setup
          </summary>
          <div className="space-y-3 border-t border-slate-800 px-4 py-3">
            <SetupPanel config={config} entitlements={entitlements} storefrontMembership={storefrontMembership} />
          </div>
        </details>
      )}

      {/* Code Footer info */}
      <div className="px-4 py-2 bg-[#0d1326] border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-2">
        {[[IN_ISLAND_TRANSACTIONS_URL, 'In-Island Transactions overview'], [CREATING_ITEMS_AND_OFFERS_URL, 'Creating Items & Offers guide'], [TRANSACTION_BEST_PRACTICES_URL, 'Best practices & debugging']].map(([url, label]) => <a key={url} href={url} target="_blank" rel="noreferrer" onClick={event => handleExternalLinkClick(event, url)} className="text-cyan-400 hover:underline flex items-center gap-1"><span>{label}</span><ExternalLink className="w-3 h-3" /></a>)}
      </div>
    </div>
  );
};
