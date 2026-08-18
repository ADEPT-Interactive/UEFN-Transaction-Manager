import fs from 'node:fs';
import path from 'node:path';
import { generateVerseCode } from '../src/services/verseGenerator';
import { BundleOffer, EntitlementItem, ProjectConfig, StorefrontMembership } from '../src/types/entitlement';

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
    triggers: { generateTriggerBinding: true, generateButtonBinding: true },
  },
  {
    id: 'audit-access', verseKey: 'uem_audit_access', name: 'Audit Access', shortDescription: 'A compile-test durable.',
    description: 'Used only to verify generated Verse.', priceVBucks: 200, itemType: 'durable', maxCount: 1,
    autoConsume: false, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: true, consequentialToGameplay: true },
    triggers: { generateTriggerBinding: true, generateButtonBinding: false },
    offerRestrictions: { minimumPurchaseAge: 18, blockedCountryCodes: ['CA'], blockedPlatformFamilies: ['IOS'] },
    alternateOffers: [{
      id: 'audit-access-alt', verseKey: 'uem_audit_access_alt', name: 'Audit Access Alternate',
      shortDescription: 'A restricted alternate compile-test offer.', description: 'Used to verify alternate offer restrictions.',
      priceVBucks: 300, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
      restrictions: { minimumPurchaseAge: 21, blockedCountryCodes: ['GB'], blockedPlatformFamilies: ['PlayStation'] },
    }],
  },
  {
    id: 'audit-random', verseKey: 'uem_audit_random', name: 'Audit Random', shortDescription: 'A paid-random compile-test consumable.',
    description: 'Used to verify paid-random metadata and supplied odds.', priceVBucks: 150, itemType: 'consumable', maxCount: 1,
    autoConsume: false, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    flags: { paidRandomItem: true, paidRandomItemOdds: '1 in 20', paidArea: false, consequentialToGameplay: true },
    triggers: { generateTriggerBinding: false, generateButtonBinding: true },
  },
  {
    id: 'audit-external-random', verseKey: 'uem_audit_external_random', name: 'Audit External Random', shortDescription: 'An externally disclosed random offer.',
    description: 'The island author supplies the final numerical odds disclosure.', priceVBucks: 200, itemType: 'consumable', maxCount: 1,
    autoConsume: false, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    flags: { paidRandomItem: true, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: false },
    triggers: { generateTriggerBinding: false, generateButtonBinding: false },
  },
];

const bundles: BundleOffer[] = [
  {
    id: 'audit-nested-bundle', verseKey: 'uem_audit_nested_bundle', name: 'Audit Nested Bundle', shortDescription: 'A nested compile-test bundle.',
    description: 'Used to verify nested bundle contents.', priceVBucks: 225, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    restrictions: { minimumPurchaseAge: 16, blockedCountryCodes: ['US'], blockedPlatformFamilies: ['Android'] },
    items: [{ entitlementId: 'audit-random', quantity: 1 }, { entitlementId: 'audit-access', offerVerseKey: 'uem_audit_access_alt', quantity: 1 }],
  },
  {
    id: 'audit-bundle', verseKey: 'uem_audit_bundle', name: 'Audit Bundle', shortDescription: 'A static compile-test bundle.',
    description: 'Used to verify generated static and nested bundle syntax.', priceVBucks: 250, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    items: [{ entitlementId: 'audit-coins', quantity: 1 }, { bundleId: 'audit-nested-bundle', quantity: 1 }],
  },
  {
    id: 'audit-dynamic-bundle', verseKey: 'uem_audit_dynamic_bundle', name: 'Audit Dynamic Bundle', shortDescription: 'A direct-purchase remaining bundle.',
    description: 'Used to verify authoritative MaxCount and runtime offer construction.', priceVBucks: 275, iconTexture: 'EntitlementIcons.UEM_PlaceholderIcon',
    dynamicRemaining: true, restrictions: { minimumPurchaseAge: 18, blockedCountryCodes: ['CA'], blockedPlatformFamilies: ['IOS'] },
    items: [{ entitlementId: 'audit-coins', quantity: 1 }],
  },
];

const storefrontMembership: StorefrontMembership = {
  allOffers: [
    { entitlementId: 'audit-coins' }, { entitlementId: 'audit-access' }, { entitlementId: 'audit-access', offerVerseKey: 'uem_audit_access_alt' },
    { entitlementId: 'audit-random' }, { entitlementId: 'audit-external-random' }, { bundleId: 'audit-bundle' }, { bundleId: 'audit-nested-bundle' },
  ],
  focused: [
    { id: 'audit-store', verseKey: 'uem_audit_store', name: 'Audit Store', generateTriggerBinding: true, entries: [{ entitlementId: 'audit-coins' }, { entitlementId: 'audit-random' }, { bundleId: 'audit-bundle' }] },
    { id: 'audit-random-store', verseKey: 'uem_audit_random_store', name: 'Audit Random Store', generateTriggerBinding: false, entries: [{ entitlementId: 'audit-random' }, { entitlementId: 'audit-external-random' }] },
  ],
};

fs.writeFileSync(outputPath, generateVerseCode(entitlements, bundles, config, storefrontMembership), 'utf8');
console.log(`Wrote ${outputPath}`);
