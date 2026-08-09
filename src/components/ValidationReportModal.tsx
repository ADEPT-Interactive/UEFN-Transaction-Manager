import React from 'react';
import { X, ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { ValidationIssue, EntitlementItem } from '../types/entitlement';

interface ValidationReportModalProps {
  isOpen: boolean;
  issues: ValidationIssue[];
  entitlements: EntitlementItem[];
  onSelectEntitlement: (item: EntitlementItem) => void;
  onClose: () => void;
}

export const ValidationReportModal: React.FC<ValidationReportModalProps> = ({
  isOpen,
  issues,
  entitlements,
  onSelectEntitlement,
  onClose,
}) => {
  if (!isOpen) return null;

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-xl bg-[#0d1326] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-modal flex flex-col max-h-[85vh]">
        
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
              <h2 className="font-extrabold text-base text-white">
                UEFN & Verse Moderation Audit
              </h2>
              <p className="text-xs text-slate-400">
                Rules validation based on Epic Games In-Island Transactions specifications
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

        {/* Audit Summary Bar */}
        <div className="px-6 py-3 bg-[#090e1a] border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 font-bold text-rose-400">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.length} Critical Errors</span>
            </span>
            <span className="flex items-center gap-1.5 font-bold text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{warnings.length} Warnings</span>
            </span>
          </div>
          {issues.length === 0 && (
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>100% Compliant</span>
            </span>
          )}
        </div>

        {/* Issues List Body */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {issues.length > 0 ? (
            issues.map(issue => {
              const matchedEnt = entitlements.find(e => e.id === issue.entitlementId);

              return (
                <div
                  key={issue.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    issue.severity === 'error'
                      ? 'bg-rose-500/5 border-rose-500/30'
                      : 'bg-amber-500/5 border-amber-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      {issue.severity === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className={`text-xs font-bold ${issue.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}`}>
                          {issue.message}
                        </p>
                        {matchedEnt && (
                          <p className="text-[11px] text-slate-400 mt-1 font-mono">
                            Target Item: <span className="text-white font-semibold">{matchedEnt.name}</span> ({matchedEnt.verseKey})
                          </p>
                        )}
                      </div>
                    </div>

                    {matchedEnt && (
                      <button
                        onClick={() => {
                          onClose();
                          onSelectEntitlement(matchedEnt);
                        }}
                        className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 px-2 py-1 rounded-lg border border-cyan-500/20 shrink-0 transition-colors"
                      >
                        <span>Fix Item</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-10 space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
              <h3 className="text-base font-bold text-white">All Checks Passed!</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                All prices are in multiples of 50, all durable/consumable rules match UEFN standards, and Verse identifiers are clean.
              </p>
            </div>
          )}
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
