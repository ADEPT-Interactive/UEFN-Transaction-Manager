import fs from 'node:fs';
import path from 'node:path';
import { generateVerseCode } from '../src/services/verseGenerator';
import { BundleOffer, EntitlementItem, OfferDisplayGroup, ProjectConfig } from '../src/types/entitlement';

const outputPath = process.argv[2];
if (!outputPath || path.basename(outputPath) !== 'uem_generator_audit.verse') {
  throw new Error('Pass an explicit output path ending in uem_generator_audit.verse.');
}

const config: ProjectConfig = {
  contentFolderPath: path.dirname(outputPath),
  targetVerseFileName: path.basename(outputPath),
  assetFolderName: 'EntitlementIcons',
  deviceClassName: 'uem_generator_audit_device',
  infoModuleName: 'UemAuditInfo',
  entitlementsModuleName: 'UemAuditEntitlements',
  pricesModuleName: 'UemAuditPrices',
  offersModuleName: 'UemAuditOffers',
  autoBackup: false,
  enableVerseWorkflowServer: true,
  generateStorefrontBinding: false,
};

const entitlements: EntitlementItem[] = [
  {
    id: 'audit-coins', verseKey: 'uem_audit_coins', name: 'Audit Coins', shortDescription: 'A compile-test consumable.',
    description: 'Used only to verify generated Verse.', priceVBucks: 100, itemType: 'consumable', maxCount: 10,
    autoConsume: true, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
    triggers: { generateTriggerBinding: true, triggerDeviceName: 'UemAuditCoinTriggers', generateButtonBinding: false, generateZoneBinding: false },
  },
  {
    id: 'audit-access', verseKey: 'uem_audit_access', name: 'Audit Access', shortDescription: 'A compile-test durable.',
    description: 'Used only to verify generated Verse.', priceVBucks: 200, itemType: 'durable', maxCount: 1,
    autoConsume: false, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: true, consequentialToGameplay: true },
    triggers: { generateTriggerBinding: true, triggerDeviceName: 'UemAuditAccessTriggers', generateButtonBinding: false, generateZoneBinding: false },
  },
];

const bundles: BundleOffer[] = [{
  id: 'audit-bundle', verseKey: 'uem_audit_bundle', name: 'Audit Bundle', shortDescription: 'Both compile-test offers.',
  description: 'Used only to verify generated bundle syntax.', priceVBucks: 250, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
  items: [{ entitlementId: 'audit-coins', quantity: 1 }, { entitlementId: 'audit-access', quantity: 1 }],
}];

const displays: OfferDisplayGroup[] = [{
  id: 'audit-store', verseKey: 'uem_audit_store', name: 'Audit Store', generateTriggerBinding: true,
  triggerDeviceName: 'UemAuditStoreTriggers', entries: [{ entitlementId: 'audit-coins' }, { bundleId: 'audit-bundle' }],
}];

fs.writeFileSync(outputPath, generateVerseCode(entitlements, bundles, config, displays), 'utf8');
console.log(`Wrote ${outputPath}`);
