import React, { useRef } from 'react';
import { X, ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { ValidationIssue, EntitlementItem } from '../types/entitlement';
import { useModalFocus } from '../hooks/useModalFocus';

interface ValidationReportModalProps {
  isOpen: boolean;
  issues: ValidationIssue[];
  dismissedWarnings: ValidationIssue[];
  entitlements: EntitlementItem[];
  isSetupIncomplete: boolean;
  onCreateEntitlement: () => void;
  onOpenSettings: () => void;
  onSelectEntitlement: (item: EntitlementItem) => void;
  onDismissWarning: (issue: ValidationIssue) => void;
  onRestoreWarning: (issue: ValidationIssue) => void;
  onRestoreAllWarnings: () => void;
  onClose: () => void;
}

export const ValidationReportModal: React.FC<ValidationReportModalProps> = ({
  isOpen,
  issues,
  dismissedWarnings,
  entitlements,
  isSetupIncomplete,
  onCreateEntitlement,
  onOpenSettings,
  onSelectEntitlement,
  onDismissWarning,
  onRestoreWarning,
  onRestoreAllWarnings,
  onClose,
  }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus({ open: isOpen, dialogRef, onEscape: onClose });
  if (!isOpen) return null;

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');
  const isSettingsIssue = (issue: ValidationIssue) => Boolean(issue.field && (issue.field === 'targetVerseFileName' || issue.field in { assetFolderName: true, deviceClassName: true, infoModuleName: true, entitlementsModuleName: true, pricesModuleName: true, offersModuleName: true }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="validation-title" tabIndex={-1} className="relative w-full max-w-xl bg-[#0d1326] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-modal flex flex-col max-h-[85vh] outline-none">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-md ${
              errors.length > 0
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : warnings.length > 0
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            }`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
                <h2 id="validation-title" className="font-extrabold text-base text-white">{isSetupIncomplete ? 'Finish setting up your first offer' : 'Review before saving'}</h2>
                <p className="text-xs text-slate-400">
                  {isSetupIncomplete ? 'An empty catalog is normal. Add an offer to unlock saving and compilation.' : 'Local checks for the generated UEFN and Verse configuration'}
                </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close validation report"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Audit Summary Bar */}
        <div className="px-6 py-3 bg-[#090e1a] border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className={`flex items-center gap-1.5 font-bold ${isSetupIncomplete ? 'text-cyan-300' : 'text-rose-400'}`}>
              {isSetupIncomplete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              <span>{isSetupIncomplete ? 'First offer needed' : `${errors.length} issues to fix`}</span>
            </span>
            <span className="flex items-center gap-1.5 font-bold text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{warnings.length} Warnings</span>
            </span>
          </div>
          {issues.length === 0 && (
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Local Checks Passed</span>
            </span>
          )}
        </div>

        {/* Issues List Body */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {issues.length > 0 ? (
            [
              { key: 'errors', title: 'Errors', entries: errors },
              { key: 'warnings', title: 'Warnings', entries: warnings },
              { key: 'info', title: 'Info', entries: infos },
            ].filter(section => section.entries.length > 0).map(section => (
              <section key={section.key} aria-labelledby={`validation-${section.key}`} className="space-y-3">
                <h3 id={`validation-${section.key}`} className={`text-[11px] font-extrabold uppercase tracking-wider ${section.key === 'errors' ? 'text-rose-300' : section.key === 'warnings' ? 'text-amber-300' : 'text-slate-300'}`}>{section.title}</h3>
                {section.entries.map(issue => {
                  const matchedEnt = entitlements.find(e => e.id === issue.entitlementId);
                  const isFirstOfferStep = isSetupIncomplete && issue.ruleName === 'entitlements_min';

                  return (
                    <div
                      key={issue.id}
                      className={`p-3.5 rounded-2xl border transition-all ${
                        issue.severity === 'error' && !isFirstOfferStep
                          ? 'bg-rose-500/5 border-rose-500/30'
                          : issue.severity === 'warning'
                          ? 'bg-amber-500/5 border-amber-500/30'
                          : 'bg-slate-500/5 border-slate-500/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          {issue.severity === 'error' && !isFirstOfferStep ? <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" /> : issue.severity === 'warning' ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
                          <div>
                            <p className={`text-xs font-bold ${isFirstOfferStep ? 'text-cyan-300' : issue.severity === 'error' ? 'text-rose-300' : issue.severity === 'warning' ? 'text-amber-300' : 'text-slate-300'}`}>{issue.message}</p>
                            {matchedEnt && <p className="text-[11px] text-slate-400 mt-1 font-mono">Target offer: <span className="text-white font-semibold">{matchedEnt.name}</span> ({matchedEnt.verseKey})</p>}
                            {issue.field && <p className="text-[10px] text-slate-500 mt-1 font-mono">Field: {issue.field}</p>}
                          </div>
                        </div>

                        {issue.severity === 'warning' ? (
                          <button type="button" onClick={() => onDismissWarning(issue)} className="shrink-0 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20">Dismiss</button>
                        ) : matchedEnt ? (
                          <button onClick={() => { onClose(); onSelectEntitlement(matchedEnt); }} className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 px-2 py-1 rounded-lg border border-cyan-500/20 shrink-0 transition-colors"><span>Fix Item</span><ArrowRight className="w-3 h-3" /></button>
                        ) : issue.ruleName === 'entitlements_min' ? (
                          <button onClick={() => { onClose(); onCreateEntitlement(); }} className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 px-2 py-1 rounded-lg border border-cyan-500/20 shrink-0 transition-colors"><span>Create offer</span><ArrowRight className="w-3 h-3" /></button>
                        ) : isSettingsIssue(issue) ? (
                          <button onClick={() => { onClose(); onOpenSettings(); }} className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 px-2 py-1 rounded-lg border border-cyan-500/20 shrink-0 transition-colors"><span>Open settings</span><ArrowRight className="w-3 h-3" /></button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))
          ) : (
            <div className="text-center py-10 space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
              <h3 className="text-base font-bold text-white">Local checks passed</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                The manager found no local schema or generator errors. UEFN compilation and Epic moderation review remain separate acceptance steps.
              </p>
            </div>
          )}
          {dismissedWarnings.length > 0 && <section aria-labelledby="dismissed-warnings" className="mt-6 border-t border-slate-800 pt-4"><div className="flex items-center justify-between gap-3"><h3 id="dismissed-warnings" className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Dismissed warnings ({dismissedWarnings.length})</h3><button type="button" onClick={onRestoreAllWarnings} className="text-[11px] font-bold text-cyan-300 hover:text-cyan-200">Restore all</button></div><div className="mt-3 space-y-2">{dismissedWarnings.map(issue => <div key={issue.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"><span className="text-slate-400">{issue.message}</span><button type="button" onClick={() => onRestoreWarning(issue)} className="shrink-0 font-bold text-cyan-300 hover:text-cyan-200">Restore</button></div>)}</div></section>}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-end bg-slate-900/50">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};
