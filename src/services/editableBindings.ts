import { toVerseApiStem } from './verseIdentity';

export type StorefrontEditableRole = 'openTriggers' | 'openButtons';

export interface EntitlementEditableNames {
  purchaseTriggers: string;
  purchaseButtons: string;
  successTriggers: string;
}

export const ALL_OFFERS_STORE_STEM = 'AllOffersStore';

export function entitlementEditableNames(verseKey: string): EntitlementEditableNames {
  const stem = toVerseApiStem(verseKey);
  return {
    purchaseTriggers: `${stem}_PurchaseTriggers`,
    purchaseButtons: `${stem}_PurchaseButtons`,
    successTriggers: `${stem}_SuccessTriggers`,
  };
}

export function storefrontEditableName(verseKey: string, role: StorefrontEditableRole = 'openTriggers'): string {
  const stem = verseKey === ALL_OFFERS_STORE_STEM ? ALL_OFFERS_STORE_STEM : toVerseApiStem(verseKey);
  return `${stem}_${role === 'openButtons' ? 'OpenButtons' : 'OpenTriggers'}`;
}

export function editableMetadataSymbol(verseKey: string, suffix: string): string {
  return `UEM_${toVerseApiStem(verseKey)}_${suffix}`;
}

export const EDITABLE_METADATA_SYMBOLS = {
  entitlementsCategory: 'UEM_EntitlementsCategory',
  storefrontsCategory: 'UEM_StorefrontsCategory',
  debugCategory: 'UEM_DebugCategory',
  purchaseTriggersCategory: 'UEM_PurchaseTriggersCategory',
  purchaseButtonsCategory: 'UEM_PurchaseButtonsCategory',
  successTriggersCategory: 'UEM_SuccessTriggersCategory',
  openTriggersCategory: 'UEM_OpenTriggersCategory',
  openButtonsCategory: 'UEM_OpenButtonsCategory',
} as const;

export const EDITABLE_CATEGORY_LABELS = {
  entitlements: 'ENTITLEMENTS',
  storefronts: 'STOREFRONTS',
  debug: 'DEBUG',
  purchaseTriggers: 'Purchase Triggers',
  purchaseButtons: 'Purchase Buttons',
  successTriggers: 'Success Triggers',
  openTriggers: 'Open Triggers',
  openButtons: 'Open Buttons',
} as const;
