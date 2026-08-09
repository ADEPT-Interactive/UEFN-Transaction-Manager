export type EntitlementType = 'durable' | 'consumable';

export type ActionHookType = 
  | 'signal_event' 
  | 'grant_stat' 
  | 'grant_currency' 
  | 'device_method' 
  | 'custom_verse';

export interface EntitlementItem {
  id: string;
  verseKey: string;             // Verse-safe symbol name, e.g. "vip_pass"
  name: string;                 // Display title with <localizes>:message support
  shortDescription: string;     // Short summary (for popups/storefronts)
  description: string;          // Full detailed description
  priceVBucks: number;          // V-Bucks cost (multiples of 50, 50-5000)
  itemType: EntitlementType;    // 'durable' vs 'consumable'
  maxCount: number;             // Maximum allowed inventory holding (1 for durables)
  autoConsume: boolean;         // If consumable: consume immediately upon grant
  iconTexture: string;          // Verse texture asset reference, e.g. "EntitlementIcons.VipPass"
  iconImageData?: string;       // Base64 PNG data for live UI preview and uasset generation
  iconFileName?: string;        // Local file name, e.g. "VipPass.png"
  
  // In-Island Transaction & Moderation Flags
  flags: {
    paidRandomItem: boolean;    // Mystery loot / RNG rewards
    paidRandomItemOdds: string; // Required disclosure for odds
    paidArea: boolean;          // Access to restricted area/paywall
    consequentialToGameplay: boolean; // Direct/indirect gameplay advantage
  };

  // Optional Age & Region Gating
  ageAndRegion: {
    enabled: boolean;
    minAge: number;
    allowedCountryCodes: string[];   // e.g. ["US", "CA"]
    disallowedCountryCodes: string[]; // e.g. ["AQ"]
  };

  // Purchase Lifecycle Hooks
  actionHook: {
    type: ActionHookType;
    eventName?: string;         // e.g. "VipPassPurchasedEvent"
    statName?: string;          // e.g. "StrengthLevels"
    statAmount?: number;        // e.g. 10
    targetDevice?: string;      // e.g. "SaveManager.GrantDoubleMoney(Player)"
    customVerseCode?: string;   // Custom Verse logic
  };

  // Cancellation & Failure Hook
  cancelHook: {
    notifyPlayer: boolean;
    notificationMessage?: string;
    customVerseCode?: string;
  };

  // Reconnection / Join Validation Hook
  rejoinHook: {
    autoRestore: boolean;
    customVerificationCode?: string;
  };

  // Trigger Bindings
  triggers: {
    generateButtonBinding: boolean;
    buttonDeviceName?: string;
    generateZoneBinding: boolean;
    mutatorZoneName?: string;
    generateAsyncListener: boolean;
    asyncEventName?: string;
  };
}

export interface BundleOfferItem {
  entitlementId: string;
  quantity: number;
}

export interface BundleOffer {
  id: string;
  verseKey: string;
  name: string;
  shortDescription: string;
  description: string;
  priceVBucks: number;
  iconTexture: string;
  iconImageData?: string;
  items: BundleOfferItem[];
}

export interface ProjectConfig {
  contentFolderPath: string;
  targetVerseFileName: string;
  assetFolderName: string;      // Custom public folder for images (default "EntitlementIcons")
  deviceClassName: string;      // Default "in_island_transactions"
  infoModuleName: string;       // Default "EntitlementInfo"
  entitlementsModuleName: string; // Default "Entitlements"
  pricesModuleName: string;     // Default "TransactionPrices"
  offersModuleName: string;     // Default "Offers"
  autoBackup: boolean;
  enableVerseWorkflowServer: boolean;
}

export interface ValidationIssue {
  id: string;
  entitlementId?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  ruleName: string;
}

export interface SimulationPlayerState {
  playerId: string;
  name: string;
  vbucksBalance: number;
  ownedEntitlements: Record<string, number>; // verseKey -> quantity
  actionLogs: Array<{
    timestamp: string;
    type: 'purchase_success' | 'purchase_cancel' | 'consumed' | 'granted' | 'validated' | 'error';
    message: string;
    entitlementKey?: string;
  }>;
}
