export type EntitlementType = 'durable' | 'consumable';

/** Runtime values are supplied by the project's Verse, never by UTM formulas. */
export type DynamicPriceBehavior = 'runtime';
export type BundleQuantityBehavior = 'fill-to-max' | 'runtime';

export interface DynamicOfferConfig {
  priceBehavior?: DynamicPriceBehavior;
}

export interface OfferRestrictions {
  minimumPurchaseAge?: number;
  blockedCountryCodes: string[];
  blockedPlatformFamilies: string[];
}

/**
 * Explicit public Verse identities imported from an existing project.
 *
 * New records intentionally omit this object: UTM derives their public names
 * from the persisted verseKey. Existing-project migrations may provide these
 * overrides when the catalog key no longer describes the published Verse API.
 */
export interface PublicIdentityOverrides {
  apiStem?: string;
  metadataStem?: string;
  entitlementStem?: string;
  priceStem?: string;
  offerStem?: string;
}

export interface AlternateOffer {
  id: string;
  verseKey: string;
  publicIdentity?: PublicIdentityOverrides;
  name: string;
  shortDescription: string;
  description: string;
  durationDescription?: string;
  priceVBucks: number;
  iconTexture: string;
  iconImageData?: string;
  restrictions: OfferRestrictions;
  dynamicOffer?: DynamicOfferConfig;
}

export interface EntitlementItem {
  id: string;
  verseKey: string;
  publicIdentity?: PublicIdentityOverrides;
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
  dynamicOffer?: DynamicOfferConfig;
  triggers: {
    generateTriggerBinding: boolean;
    generateButtonBinding: boolean;
    generateSuccessTriggerBinding: boolean;
    /** Fires once on reconciliation when this durable entitlement is owned. */
    generateOwnershipConfirmedTriggerBinding?: boolean;
  };
}

export interface BundleOfferItem {
  entitlementId?: string;
  bundleId?: string;
  offerVerseKey?: string;
  quantity: number;
  /** Omitted means the existing fixed quantity behavior. */
  quantityBehavior?: BundleQuantityBehavior;
}

export interface BundleOffer {
  id: string;
  verseKey: string;
  publicIdentity?: PublicIdentityOverrides;
  name: string;
  shortDescription: string;
  description: string;
  priceVBucks: number;
  iconTexture: string;
  iconImageData?: string;
  durationDescription?: string;
  restrictions?: OfferRestrictions;
  dynamicOffer?: DynamicOfferConfig;
  /** @deprecated Read-only compatibility for pre-4.2 manifests. */
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
  publicIdentity?: PublicIdentityOverrides;
  name: string;
  entries: OfferDisplayEntry[];
  generateTriggerBinding: boolean;
}

/**
 * The complete, explicit storefront composition for a managed project.
 * Entries refer to concrete Marketplace offers, not entitlement ownership.
 */
export interface StorefrontMembership {
  allOffers: OfferDisplayEntry[];
  focused: OfferDisplayGroup[];
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
}

/**
 * The generated module and device names embedded in a managed Verse file.
 *
 * The target filename is deliberately not duplicated here: the manifest is
 * read from that file, so the active file path remains the source of truth.
 */
export type GeneratedModuleConfiguration = Pick<ProjectConfig,
  'assetFolderName'
  | 'deviceClassName'
  | 'infoModuleName'
  | 'entitlementsModuleName'
  | 'pricesModuleName'
  | 'offersModuleName'
>;

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
  storefrontMembership?: StorefrontMembership;
  /** Legacy project-data input. New manifests serialize storefrontMembership. */
  offerDisplayGroups?: OfferDisplayGroup[];
  /** Stable keys that were issued and must not be silently reassigned. */
  retiredVerseKeys?: string[];
  /** Generated names captured so an existing project's public paths survive a reopen. */
  generatedModuleConfiguration?: GeneratedModuleConfiguration;
}
