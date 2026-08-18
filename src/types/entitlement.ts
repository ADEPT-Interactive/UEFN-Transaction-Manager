export type EntitlementType = 'durable' | 'consumable';

export interface OfferRestrictions {
  minimumPurchaseAge?: number;
  blockedCountryCodes: string[];
  blockedPlatformFamilies: string[];
}

export interface AlternateOffer {
  id: string;
  verseKey: string;
  name: string;
  shortDescription: string;
  description: string;
  durationDescription?: string;
  priceVBucks: number;
  iconTexture: string;
  restrictions: OfferRestrictions;
}

export interface EntitlementItem {
  id: string;
  verseKey: string;
  name: string;
  shortDescription: string;
  description: string;
  priceVBucks: number;
  itemType: EntitlementType;
  maxCount: number;
  autoConsume: boolean;
  iconTexture: string;
  iconImageData?: string;
  iconFileName?: string;
  flags: {
    paidRandomItem: boolean;
    paidRandomItemOdds: string;
    paidArea: boolean;
    consequentialToGameplay: boolean;
  };
  durationDescription?: string;
  offerRestrictions?: OfferRestrictions;
  alternateOffers?: AlternateOffer[];
  triggers: {
    generateTriggerBinding: boolean;
    generateButtonBinding: boolean;
    generateZoneBinding: boolean;
  };
}

export interface BundleOfferItem {
  entitlementId?: string;
  bundleId?: string;
  offerVerseKey?: string;
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
  durationDescription?: string;
  restrictions?: OfferRestrictions;
  dynamicRemaining?: boolean;
  items: BundleOfferItem[];
}

export interface OfferDisplayEntry {
  entitlementId?: string;
  bundleId?: string;
  offerVerseKey?: string;
}

export interface OfferDisplayGroup {
  id: string;
  verseKey: string;
  name: string;
  entries: OfferDisplayEntry[];
  generateTriggerBinding: boolean;
}

export interface ProjectConfig {
  contentFolderPath: string;
  targetVerseFileName: string;
  assetFolderName: string;
  deviceClassName: string;
  infoModuleName: string;
  entitlementsModuleName: string;
  pricesModuleName: string;
  offersModuleName: string;
  autoBackup: boolean;
  enableVerseWorkflowServer: boolean;
  generateStorefrontBinding?: boolean;
  allowAutomaticZonePrompts?: boolean;
}

export interface ValidationIssue {
  id: string;
  entitlementId?: string;
  bundleId?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  ruleName: string;
}

export interface ManagedProjectData {
  schemaVersion: 2 | 3 | 4;
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  offerDisplayGroups?: OfferDisplayGroup[];
  /** Stable keys that were issued and must not be silently reassigned. */
  retiredVerseKeys?: string[];
}
