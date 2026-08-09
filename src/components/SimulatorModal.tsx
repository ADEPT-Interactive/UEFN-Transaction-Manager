import React, { useState } from 'react';
import { 
  X, 
  Play, 
  Coins, 
  Sparkles, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  User, 
  Terminal, 
  ShieldCheck,
  ShoppingBag,
  Layers,
  ArrowRight
} from 'lucide-react';
import { EntitlementItem, SimulationPlayerState } from '../types/entitlement';

interface SimulatorModalProps {
  isOpen: boolean;
  entitlements: EntitlementItem[];
  initialSelectedItem?: EntitlementItem | null;
  onClose: () => void;
}

export const SimulatorModal: React.FC<SimulatorModalProps> = ({
  isOpen,
  entitlements,
  initialSelectedItem,
  onClose,
}) => {
  if (!isOpen) return null;

  // Simulation State
  const [playerState, setPlayerState] = useState<SimulationPlayerState>({
    playerId: 'player_01',
    name: 'FortnitePlayer_99',
    vbucksBalance: 2500,
    ownedEntitlements: {},
    actionLogs: [
      {
        timestamp: new Date().toLocaleTimeString(),
        type: 'validated',
        message: '[Simulation Init] Player joined playspace. Running ValidatePreviousPurchases.',
      }
    ],
  });

  const [activePurchaseOffer, setActivePurchaseOffer] = useState<EntitlementItem | null>(initialSelectedItem || null);

  const logAction = (type: SimulationPlayerState['actionLogs'][0]['type'], message: string, key?: string) => {
    setPlayerState(prev => ({
      ...prev,
      actionLogs: [
        {
          timestamp: new Date().toLocaleTimeString(),
          type,
          message,
          entitlementKey: key,
        },
        ...prev.actionLogs.slice(0, 49),
      ],
    }));
  };

  // 1. Confirm Purchase Handler
  const handleConfirmPurchase = (item: EntitlementItem) => {
    if (playerState.vbucksBalance < item.priceVBucks) {
      logAction('error', `[IIT] Purchase Failed: Insufficient V-Bucks (${playerState.vbucksBalance} available, ${item.priceVBucks} required).`, item.verseKey);
      setActivePurchaseOffer(null);
      return;
    }

    // Deduct V-Bucks
    const newBalance = playerState.vbucksBalance - item.priceVBucks;
    const currentOwned = playerState.ownedEntitlements[item.verseKey] || 0;
    const newOwned = currentOwned + 1;

    setPlayerState(prev => ({
      ...prev,
      vbucksBalance: newBalance,
      ownedEntitlements: {
        ...prev.ownedEntitlements,
        [item.verseKey]: item.autoConsume ? currentOwned : newOwned,
      },
    }));

    logAction(
      'purchase_success', 
      `[IIT] Purchase Confirmed: "${item.name}" for ${item.priceVBucks} V-Bucks. OnPurchasesChanged fired!`, 
      item.verseKey
    );

    // Fire custom action hook if defined
    if (item.actionHook.type === 'signal_event' && item.actionHook.eventName) {
      logAction('granted', `[Verse Event] ${item.actionHook.eventName}.Signal(Player)`, item.verseKey);
    } else if (item.actionHook.type === 'device_method') {
      logAction('granted', `[Device Hook] ${item.actionHook.targetDevice}`, item.verseKey);
    }

    // Auto-consumption check
    if (item.itemType === 'consumable' && item.autoConsume) {
      logAction('consumed', `[IIT] TryConsumeEntitlement: Consumed 1x ${item.name} immediately upon receipt.`, item.verseKey);
    }

    setActivePurchaseOffer(null);
  };

  // 2. Cancel Purchase Handler
  const handleCancelPurchase = (item: EntitlementItem) => {
    logAction(
      'purchase_cancel',
      `[IIT] BuyOffer Result was False: Player cancelled transaction dialog for "${item.name}". PurchaseCancelledEvent signaled.`,
      item.verseKey
    );
    if (item.cancelHook.notifyPlayer && item.cancelHook.notificationMessage) {
      logAction('purchase_cancel', `[Notification] ${item.cancelHook.notificationMessage}`, item.verseKey);
    }
    setActivePurchaseOffer(null);
  };

  // 3. Simulate Reconnection / Validate Previous Purchases
  const handleSimulateRejoin = () => {
    logAction('validated', `[Reconnection] Player disconnected and rejoined. Running ValidatePreviousPurchases(Player)...`);
    let restoredCount = 0;
    for (const [key, count] of Object.entries(playerState.ownedEntitlements)) {
      if (count > 0) {
        const ent = entitlements.find(e => e.verseKey === key);
        if (ent) {
          restoredCount++;
          logAction('granted', `[Restored] Verified ownership of durable "${ent.name}". Rejoin hooks fired.`, key);
        }
      }
    }
    if (restoredCount === 0) {
      logAction('validated', `[Validation] No active durable entitlements found for player.`);
    }
  };

  // Reset Wallet & State
  const handleReset = () => {
    setPlayerState({
      playerId: 'player_01',
      name: 'FortnitePlayer_99',
      vbucksBalance: 2500,
      ownedEntitlements: {},
      actionLogs: [
        {
          timestamp: new Date().toLocaleTimeString(),
          type: 'validated',
          message: '[Simulation Reset] Reset wallet to 2,500 V-Bucks and cleared inventory.',
        }
      ],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#0d1326] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-modal flex flex-col max-h-[92vh]">
        
        {/* Simulator Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-500/20">
              <Play className="w-5 h-5 fill-current text-white" />
            </div>
            <div>
              <h2 className="font-extrabold text-base text-white flex items-center gap-2">
                <span>In-Island Transactions Simulator</span>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono">
                  Sandbox v1.0
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Test player purchase flows, cancellations, and Verse event triggers in real-time
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

        {/* Player Profile & Wallet Bar */}
        <div className="px-6 py-3 bg-[#090e1a] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400">
              <User className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">{playerState.name}</p>
              <p className="text-[10px] text-slate-400 font-mono">ID: {playerState.playerId}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Wallet balance */}
            <div className="flex items-center gap-2 bg-sky-500/10 border border-sky-400/30 px-3 py-1.5 rounded-xl shadow-inner">
              <Coins className="w-4 h-4 text-sky-400 animate-pulse-subtle" />
              <span className="font-mono text-sm font-extrabold text-sky-300">
                {playerState.vbucksBalance.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-sky-400 uppercase">V-Bucks</span>
            </div>

            {/* Quick Actions */}
            <button
              onClick={handleSimulateRejoin}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="Simulate player disconnecting and rejoining (tests ValidatePreviousPurchases)"
            >
              Simulate Rejoin
            </button>

            <button
              onClick={handleReset}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              title="Reset Sandbox State"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-slate-800 overflow-hidden">
          
          {/* Left Column: Storefront Offers Catalog */}
          <div className="p-6 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <ShoppingBag className="w-4 h-4 text-cyan-400" />
                <span>Available Offers ({entitlements.length})</span>
              </h3>
              <span className="text-[11px] text-slate-500">Click an offer to initiate TryBuyOffer</span>
            </div>

            {entitlements.length > 0 ? (
              <div className="space-y-2.5">
                {entitlements.map(item => {
                  const ownedQty = playerState.ownedEntitlements[item.verseKey] || 0;
                  const isDurableOwned = item.itemType === 'durable' && ownedQty > 0;

                  return (
                    <div
                      key={item.id}
                      onClick={() => !isDurableOwned && setActivePurchaseOffer(item)}
                      className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                        isDurableOwned
                          ? 'bg-slate-900/40 border-slate-800/80 opacity-60 cursor-not-allowed'
                          : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-800 hover:border-cyan-400/50 cursor-pointer shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
                          {item.iconImageData ? (
                            <img src={item.iconImageData} alt={item.name} className="w-full h-full object-contain p-0.5" />
                          ) : (
                            <Sparkles className="w-5 h-5 text-cyan-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-xs text-white truncate">{item.name}</p>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5 font-mono">
                            Key: <span className="text-cyan-300">{item.verseKey}</span>
                          </p>
                          {ownedQty > 0 && (
                            <span className="text-[10px] text-emerald-400 font-semibold mt-1 inline-block">
                              Owned: x{ownedQty}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {isDurableOwned ? (
                          <span className="text-xs font-bold text-slate-500 bg-slate-800 px-2 py-1 rounded-md">
                            Owned
                          </span>
                        ) : (
                          <div className="flex items-center gap-1 text-xs font-mono font-bold text-sky-400 bg-sky-500/10 border border-sky-400/30 px-2.5 py-1 rounded-lg">
                            <Coins className="w-3 h-3 text-sky-400" />
                            <span>{item.priceVBucks} VB</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 text-center py-8">No entitlements in project.</p>
            )}
          </div>

          {/* Right Column: Active Simulation Log & Activity Console */}
          <div className="p-6 overflow-y-auto flex flex-col space-y-4 bg-[#090e1a]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>Live Verse Event Activity Log</span>
              </h3>
              <span className="text-[11px] text-slate-500 font-mono">
                {playerState.actionLogs.length} events
              </span>
            </div>

            {/* Terminal log console */}
            <div className="flex-1 bg-[#05070d] border border-slate-800/90 rounded-2xl p-3 font-mono text-xs overflow-y-auto max-h-[420px] space-y-2 select-text">
              {playerState.actionLogs.map((log, idx) => {
                let color = 'text-slate-300';
                if (log.type === 'purchase_success') color = 'text-emerald-400 font-bold';
                if (log.type === 'purchase_cancel') color = 'text-amber-400 font-medium';
                if (log.type === 'consumed') color = 'text-purple-300';
                if (log.type === 'granted') color = 'text-cyan-300 font-medium';
                if (log.type === 'error') color = 'text-rose-400 font-bold';

                return (
                  <div key={idx} className="flex items-start gap-2 border-b border-slate-900/60 pb-1.5 last:border-0">
                    <span className="text-[10px] text-slate-600 shrink-0">{log.timestamp}</span>
                    <span className={`text-xs ${color} leading-snug`}>{log.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Realistic Fortnite Purchase Confirmation Dialog Overlay */}
        {activePurchaseOffer && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
            <div className="relative w-full max-w-md bg-[#111827] border-2 border-sky-400 rounded-3xl p-6 shadow-2xl shadow-sky-500/20 text-center space-y-5">
              
              <div className="w-20 h-20 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto overflow-hidden shadow-lg">
                {activePurchaseOffer.iconImageData ? (
                  <img src={activePurchaseOffer.iconImageData} alt={activePurchaseOffer.name} className="w-full h-full object-contain p-1" />
                ) : (
                  <Sparkles className="w-10 h-10 text-sky-400" />
                )}
              </div>

              <div>
                <span className="text-[10px] uppercase tracking-widest font-extrabold text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded-full border border-sky-400/30">
                  Fortnite In-Island Transaction
                </span>
                <h3 className="text-xl font-extrabold text-white mt-2">
                  {activePurchaseOffer.name}
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-xs mx-auto">
                  {activePurchaseOffer.shortDescription || activePurchaseOffer.description}
                </p>
              </div>

              {/* Price Banner */}
              <div className="bg-sky-500/10 border border-sky-400/30 rounded-2xl py-3 px-4 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">Total Price:</span>
                <div className="flex items-center gap-1.5 font-mono text-base font-extrabold text-sky-300">
                  <Coins className="w-4 h-4 text-sky-400" />
                  <span>{activePurchaseOffer.priceVBucks.toLocaleString()} V-Bucks</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleCancelPurchase(activePurchaseOffer)}
                  className="py-2.5 px-4 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmPurchase(activePurchaseOffer)}
                  className="py-2.5 px-4 rounded-xl text-xs font-extrabold bg-gradient-to-r from-sky-400 to-blue-600 hover:from-sky-300 hover:to-blue-500 text-slate-950 shadow-lg shadow-sky-500/30 transition-all active:scale-95"
                >
                  Confirm & Buy
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
