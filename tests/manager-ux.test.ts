import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BundleOffer, EntitlementItem, OfferDisplayGroup, ProjectConfig } from '../src/types/entitlement';
import { bundleDraftSnapshot, entitlementDraftSnapshot, projectConfigDraftSnapshot, storefrontDraftSnapshot } from '../src/services/draftSnapshots';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const entitlement: EntitlementItem = {
  id: 'ent-vip', verseKey: 'vip', name: 'VIP', shortDescription: 'Short', description: 'Long', priceVBucks: 100,
  itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.Vip', iconImageData: 'transient', iconFileName: 'Vip.png',
  flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
  triggers: { generateTriggerBinding: true, generateButtonBinding: false },
  offerRestrictions: { blockedCountryCodes: ['CA', 'US'], blockedPlatformFamilies: ['Windows', 'Android'] },
};

const bundle: BundleOffer = {
  id: 'bundle-starter', verseKey: 'starter', name: 'Starter', shortDescription: 'Short', description: 'Long', priceVBucks: 500,
  iconTexture: 'EntitlementIcons.Starter', iconImageData: 'transient', restrictions: { blockedCountryCodes: ['US', 'CA'], blockedPlatformFamilies: ['Android', 'Windows'] }, items: [],
};

const storefront: OfferDisplayGroup = { id: 'store-one', verseKey: 'store_one', name: 'Store', entries: [{ entitlementId: 'ent-vip' }], generateTriggerBinding: true };
const config: ProjectConfig = {
  contentFolderPath: 'O:/Projects/Example/Content', targetVerseFileName: 'managed_transactions.verse', assetFolderName: 'EntitlementIcons', deviceClassName: 'TransactionManager',
  infoModuleName: 'ManagedEntitlementInfo', entitlementsModuleName: 'ManagedEntitlements', pricesModuleName: 'ManagedTransactionPrices', offersModuleName: 'ManagedOffers',
  autoBackup: true, enableVerseWorkflowServer: true,
};

test('draft snapshots ignore transient images and equivalent restriction ordering', () => {
  const reordered = {
    ...entitlement,
    iconImageData: 'different-transient-preview',
    offerRestrictions: { blockedCountryCodes: ['US', 'CA'], blockedPlatformFamilies: ['Android', 'Windows'] },
  };
  assert.equal(entitlementDraftSnapshot(entitlement), entitlementDraftSnapshot(reordered));
  assert.notEqual(entitlementDraftSnapshot(entitlement), entitlementDraftSnapshot({ ...entitlement, description: 'Changed' }));
  assert.equal(bundleDraftSnapshot(bundle), bundleDraftSnapshot({ ...bundle, iconImageData: 'another-preview', restrictions: { blockedCountryCodes: ['CA', 'US'], blockedPlatformFamilies: ['Windows', 'Android'] } }));
  assert.notEqual(bundleDraftSnapshot(bundle), bundleDraftSnapshot({ ...bundle, priceVBucks: 600 }));
});

test('draft snapshots preserve editable storefront order and ignore the launcher content root', () => {
  assert.notEqual(storefrontDraftSnapshot(storefront), storefrontDraftSnapshot({ ...storefront, entries: [{ bundleId: 'bundle-starter' }] }));
  assert.equal(projectConfigDraftSnapshot(config), projectConfigDraftSnapshot({ ...config, contentFolderPath: 'O:/Projects/Another/Content' }));
  assert.notEqual(projectConfigDraftSnapshot(config), projectConfigDraftSnapshot({ ...config, targetVerseFileName: 'other.verse' }));
});

test('Manager editors use lifecycle-stable focus, shared dirty confirmation, and capability-driven icon importing', () => {
  const focusSource = read('src/hooks/useModalFocus.ts');
  const modalSource = read('src/components/EntitlementModal.tsx');
  const bundleSource = read('src/components/BundleManager.tsx');
  const storefrontSource = read('src/components/OfferDisplayManager.tsx');
  const settingsSource = read('src/components/ProjectSettingsModal.tsx');
  const uploadSource = read('src/components/ImageUploadZone.tsx');
  const countrySource = read('src/components/OfferRestrictionsEditor.tsx');
  assert.match(focusSource, /onEscapeRef/);
  assert.match(focusSource, /\[open, dialogRef, initialFocusRef\]/);
  assert.doesNotMatch(focusSource, /\[open, dialogRef, initialFocusRef, onEscape\]/);
  for (const source of [modalSource, bundleSource, storefrontSource, settingsSource]) {
    assert.match(source, /useModalFocus/);
    assert.match(source, /DraftConfirmDialog/);
    assert.match(source, /onDiscard/);
    assert.match(source, /onContinue/);
  }
  assert.match(modalSource, /nativeTextureImportAvailable/);
  assert.match(modalSource, /full Python connection to UEFN/);
  assert.match(uploadSource, /disabled=\{!nativeTextureImportAvailable\}/);
  assert.match(uploadSource, /aria-describedby=\{!nativeTextureImportAvailable/);
  assert.match(countrySource, /useClickAway/);
  assert.match(countrySource, /onKeyDownCapture/);
  assert.match(countrySource, /countryTriggerRef\.current\?\.focus/);
});

test('4.3 creator workflow keeps keys and native assets managed while exposing concise controls', () => {
  const appSource = read('src/App.tsx');
  const modalSource = read('src/components/EntitlementModal.tsx');
  const bundleSource = read('src/components/BundleManager.tsx');
  const cardSource = read('src/components/EntitlementCard.tsx');
  const headerSource = read('src/components/Header.tsx');
  const verseSource = read('src/components/VersePreview.tsx');
  const numericSource = read('src/components/NumericInput.tsx');
  const placeholderSource = read('src/constants/placeholderIcon.ts');
  const placeholderSvg = read('electron/assets/utm-placeholder-icon.svg');
  const mainSource = read('electron/main.ts');
  assert.match(modalSource, /Step \$\{creationStep \+ 1\} of 3/);
  assert.match(modalSource, /Save Offer/);
  assert.doesNotMatch(modalSource, /offer-verse-key/);
  assert.match(modalSource, /Transaction Events/);
  assert.match(bundleSource, /role="button"/);
  assert.doesNotMatch(bundleSource, />Edit<\/button>/);
  assert.match(cardSource, /PlaceholderIcon/);
  assert.match(cardSource, /role="button"/);
  assert.match(headerSource, /No Issues/);
  assert.doesNotMatch(verseSource, /Write to Content/);
  assert.match(numericSource, /Decrease \$\{ariaLabel\}/);
  assert.match(numericSource, /utm-number-input/);
  assert.match(placeholderSource, /UTM_PlaceholderIcon/);
  assert.match(placeholderSource, /data:image\/png;base64/);
  assert.match(placeholderSvg, /PLACE/);
  assert.match(placeholderSvg, /HOLDER/);
  assert.match(appSource, /Open project in UEFN/);
  assert.match(mainSource, /shell\.openPath\(verified\.projectFile\)/);
});
