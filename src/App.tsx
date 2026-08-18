import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpenCheck, CheckCircle2, Columns, FileCode, ImageIcon, Layers, PlugZap } from 'lucide-react';
import { Header } from './components/Header';
import { EntitlementList } from './components/EntitlementList';
import { EntitlementModal } from './components/EntitlementModal';
import { VersePreview } from './components/VersePreview';
import { ValidationReportModal } from './components/ValidationReportModal';
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { BundleManager } from './components/BundleManager';
import { OfferDisplayManager } from './components/OfferDisplayManager';
import { BundleOffer, EntitlementItem, ProjectConfig, StorefrontMembership } from './types/entitlement';
import { DEFAULT_PRESETS, LEGACY_STARTER_PRESET_KEYS } from './constants/presets';
import { generateVerseCode } from './services/verseGenerator';
import { parseVerseCode } from './services/verseParser';
import { sanitizeVerseIdentifier, toPascalCase, validateEntireProject } from './services/validator';
import { EditorStatus, FileService } from './services/fileService';
import { cleanManagedData, legacyProjectConfigDiagnostics, normalizeEntitlement, normalizeProjectConfig, parseManagedData, parseStoredArray, parseStoredStorefrontMembership } from './services/projectSchema';
import { PLACEHOLDER_ICON_ASSET_NAME } from './constants/placeholderIcon';
import { duplicateEntitlement } from './services/duplicateEntitlement';
import { createVerseKeyAllocator, collectManagedVerseKeys, normalizeRetiredVerseKeys } from './services/verseIdentity';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SetupModal } from './components/SetupPanel';
import { DesktopTitleBar, isDesktopHost, postDesktopWindowAction } from './components/DesktopTitleBar';

const launchContext = typeof window === 'undefined'
  ? { contentFolderPath: '' }
  : FileService.consumeLaunchContext();

const DEFAULT_CONFIG: ProjectConfig = {
  contentFolderPath: launchContext.contentFolderPath,
  targetVerseFileName: launchContext.targetVerseFileName ?? 'managed_transactions.verse',
  assetFolderName: launchContext.assetFolderName ?? 'EntitlementIcons',
  deviceClassName: 'managed_transactions_device',
  infoModuleName: 'ManagedEntitlementInfo',
  entitlementsModuleName: 'ManagedEntitlements',
  pricesModuleName: 'ManagedTransactionPrices',
  offersModuleName: 'ManagedOffers',
  autoBackup: true,
  enableVerseWorkflowServer: true,
  generateStorefrontBinding: false,
};

const STORAGE_NAMESPACE = FileService.getStorageNamespace(launchContext.contentFolderPath);
const storageKey = (name: string) => `${STORAGE_NAMESPACE}:${name}`;

const LEGACY_STARTER_PRESET_IDENTITIES: Record<typeof LEGACY_STARTER_PRESET_KEYS[number], {
  name: string;
  shortDescription: string;
  description: string;
  priceVBucks: number;
  itemType: EntitlementItem['itemType'];
  maxCount: number;
  autoConsume: boolean;
  iconTexture: string;
  paidRandomItem: boolean;
  paidRandomItemOdds: string;
  paidArea: boolean;
  consequentialToGameplay: boolean;
}> = {
  vip_pass: { name: 'VIP Pass', shortDescription: 'Unlock exclusive VIP access and benefits.', description: 'Grants permanent access to the island VIP experience.', priceVBucks: 500, itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.Icon_VIP', paidRandomItem: false, paidRandomItemOdds: '', paidArea: true, consequentialToGameplay: true },
  strength_boost_10: { name: '+10 Strength Boost', shortDescription: 'Adds ten strength levels immediately.', description: 'A consumable boost that grants ten strength levels.', priceVBucks: 150, itemType: 'consumable', maxCount: 5, autoConsume: true, iconTexture: 'EntitlementIcons.Strength_10', paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
  double_money: { name: '2x Cash Multiplier', shortDescription: 'Permanently doubles eligible cash earnings.', description: 'Grants a permanent two-times cash multiplier for this island.', priceVBucks: 400, itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.Double_Cash', paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
  mystery_crate: { name: 'Mystery Crate', shortDescription: 'Open one crate for a disclosed random reward.', description: 'Contains one randomized island reward.', priceVBucks: 100, itemType: 'consumable', maxCount: 10, autoConsume: true, iconTexture: 'EntitlementIcons.MysteryCrate', paidRandomItem: true, paidRandomItemOdds: 'Common: 60%, Rare: 30%, Epic: 8%, Legendary: 2%', paidArea: false, consequentialToGameplay: true },
  bag_expansion_10: { name: '+10 Backpack Slots', shortDescription: 'Adds ten inventory slots immediately.', description: 'A consumable expansion that grants ten additional inventory slots.', priceVBucks: 100, itemType: 'consumable', maxCount: 7, autoConsume: true, iconTexture: 'EntitlementIcons.Inventory_10', paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
};

function isUntouchedLegacyStarterCatalog(items: EntitlementItem[]): boolean {
  if (items.length !== LEGACY_STARTER_PRESET_KEYS.length) return false;
  const byKey = new Map(items.map(item => [item.verseKey, item]));
  return LEGACY_STARTER_PRESET_KEYS.every(key => {
    const item = byKey.get(key);
    const expected = LEGACY_STARTER_PRESET_IDENTITIES[key];
    return Boolean(item)
      && item!.name === expected.name
      && item!.shortDescription === expected.shortDescription
      && item!.description === expected.description
      && item!.priceVBucks === expected.priceVBucks
      && item!.itemType === expected.itemType
      && item!.maxCount === expected.maxCount
      && item!.autoConsume === expected.autoConsume
      && item!.iconTexture === expected.iconTexture
      && item!.flags.paidRandomItem === expected.paidRandomItem
      && item!.flags.paidRandomItemOdds === expected.paidRandomItemOdds
      && item!.flags.paidArea === expected.paidArea
      && item!.flags.consequentialToGameplay === expected.consequentialToGameplay;
  });
}

function loadConfig(): ProjectConfig {
  try {
    const saved = localStorage.getItem(storageKey('config'));
    const parsed = saved ? JSON.parse(saved) : null;
    return normalizeProjectConfig(parsed, DEFAULT_CONFIG);
  } catch {
    localStorage.removeItem(storageKey('config'));
    return DEFAULT_CONFIG;
  }
}

function loadEntitlements(): EntitlementItem[] {
  try {
    const stored = parseStoredArray(localStorage.getItem(storageKey('entitlements')), 'entitlements') as EntitlementItem[] | null;
    if (stored) {
      const starterCatalog = DEFAULT_PRESETS.map((preset, index) => normalizeEntitlement(preset, index));
      const storedStarterCatalog = JSON.stringify(cleanManagedData(stored, []).entitlements);
      const defaultStarterCatalog = JSON.stringify(cleanManagedData(starterCatalog, []).entitlements);
      // Migrate either the current or the old first-launch seed without
      // removing a catalog whose visible values were edited by the user.
      return storedStarterCatalog === defaultStarterCatalog || isUntouchedLegacyStarterCatalog(stored) ? [] : stored;
    }
  } catch {
    localStorage.removeItem(storageKey('entitlements'));
  }
  return [];
}

function loadBundles(): BundleOffer[] {
  try {
    return (parseStoredArray(localStorage.getItem(storageKey('bundles')), 'bundles') as BundleOffer[] | null) ?? [];
  } catch {
    localStorage.removeItem(storageKey('bundles'));
    return [];
  }
}

function loadStorefrontMembership(entitlements: EntitlementItem[], bundles: BundleOffer[]): StorefrontMembership {
  try {
    const stored = localStorage.getItem(storageKey('storefrontMembership')) ?? localStorage.getItem(storageKey('offerDisplayGroups'));
    return parseStoredStorefrontMembership(stored, entitlements, bundles);
  } catch {
    localStorage.removeItem(storageKey('storefrontMembership'));
    return legacyStorefrontMembershipFallback(entitlements, bundles);
  }
}

function legacyStorefrontMembershipFallback(entitlements: EntitlementItem[], bundles: BundleOffer[]): StorefrontMembership {
  const allOffers: StorefrontMembership['allOffers'] = entitlements.flatMap(item => [{ entitlementId: item.id }, ...(item.alternateOffers ?? []).map(offer => ({ entitlementId: item.id, offerVerseKey: offer.verseKey }))] as StorefrontMembership['allOffers'])
    .concat(bundles.filter(bundle => !bundle.dynamicRemaining).map(bundle => ({ bundleId: bundle.id }) as StorefrontMembership['allOffers'][number]));
  return { allOffers, focused: [] };
}

function loadRetiredVerseKeys(): string[] {
  try {
    const stored = localStorage.getItem(storageKey('retiredVerseKeys'));
    return normalizeRetiredVerseKeys(stored ? JSON.parse(stored) : []);
  } catch {
    localStorage.removeItem(storageKey('retiredVerseKeys'));
    return [];
  }
}

function allocateProjectVerseKey(
  name: string,
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  storefrontMembership: StorefrontMembership,
  retiredVerseKeys: string[],
): string {
  return createVerseKeyAllocator(collectManagedVerseKeys(entitlements, bundles, storefrontMembership.focused), retiredVerseKeys).allocate(name);
}

function addRetiredVerseKeys(current: string[], keys: Iterable<string>): string[] {
  return normalizeRetiredVerseKeys([...current, ...keys]);
}

function snapshot(entitlements: EntitlementItem[], bundles: BundleOffer[], storefrontMembership: StorefrontMembership, retiredVerseKeys: string[], config: ProjectConfig): string {
  return JSON.stringify({ ...cleanManagedData(entitlements, bundles, storefrontMembership, retiredVerseKeys), config: { ...config, contentFolderPath: '' } });
}

async function hydrateProjectImages(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  assetFolderName: string,
): Promise<{ entitlements: EntitlementItem[]; bundles: BundleOffer[]; loadedCount: number }> {
  const scan = await FileService.scanProject(assetFolderName);
  if (!scan.success || !scan.iconPreviews?.length) return { entitlements, bundles, loadedCount: 0 };

  const imageEntries = await Promise.all((scan.iconPreviews ?? []).map(async preview => ({
    preview,
    imageData: await FileService.loadProjectIconPreview(preview),
  })));
  const imagesByRef = new Map(imageEntries.filter(entry => entry.imageData).map(entry => [entry.preview.verseAssetPath, { imageData: entry.imageData as string, assetName: entry.preview.assetName }]));
  const getImage = (textureRef: string) => {
    const exact = imagesByRef.get(textureRef);
    if (exact) return exact;
    const assetName = textureRef.split('.').pop() ?? '';
    return imagesByRef.get(`${assetFolderName}.${assetName}`);
  };
  const applyImage = <T extends { iconTexture: string; iconImageData?: string; iconFileName?: string }>(item: T): T => {
    const image = getImage(item.iconTexture);
    return image ? { ...item, iconImageData: image.imageData, iconFileName: `${image.assetName}.png` } : item;
  };
  const hydratedEntitlements = entitlements.map(applyImage);
  const hydratedBundles = bundles.map(applyImage);
  return {
    entitlements: hydratedEntitlements,
    bundles: hydratedBundles,
    loadedCount: hydratedEntitlements.filter((item, index) => item.iconImageData !== entitlements[index].iconImageData).length
      + hydratedBundles.filter((item, index) => item.iconImageData !== bundles[index].iconImageData).length,
  };
}

const SetupGuide: React.FC<{ bridgeConnected: boolean; onCreateEntitlement: () => void }> = ({ bridgeConnected, onCreateEntitlement }) => {
  if (!bridgeConnected) {
    return (
      <section className="mx-auto mb-6 max-w-6xl rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5" aria-labelledby="connect-uefn-heading">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Project connection lost</p>
        <h2 id="connect-uefn-heading" className="mt-1 text-base font-extrabold text-white">Switch projects and link it again</h2>
        <p className="mt-1 text-xs leading-5 text-slate-300">The secure project bridge is unavailable, so disk operations are temporarily disabled.</p>
        <ol className="mt-4 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
          <li className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><span className="font-bold text-cyan-300">1.</span> Open the Project menu above.</li>
          <li className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><span className="font-bold text-cyan-300">2.</span> Choose <strong>Switch active project</strong>.</li>
          <li className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><span className="font-bold text-cyan-300">3.</span> Select the intended project in the launcher.</li>
        </ol>
      </section>
    );
  }

  return (
    <section className="mx-auto mb-6 max-w-6xl rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-5" aria-labelledby="first-offer-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">Project connected</p>
          <h2 id="first-offer-heading" className="mt-1 text-base font-extrabold text-white">Create your first offer</h2>
          <p className="mt-1 text-xs leading-5 text-slate-300">Start with a blank offer or a broad entitlement category. You can add bundles after you have offers.</p>
        </div>
        <button type="button" onClick={onCreateEntitlement} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-cyan-300">
          Create first offer <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-400"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Add offer details</span><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Save to project</span><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Compile in UEFN</span></div>
    </section>
  );
};

const EditorCapabilityNotice: React.FC<{ status: EditorStatus | null }> = ({ status }) => {
  if (!status?.success) return null;
  const connected = status.editorConnected;
  const active = status.projectActive;
  const tone = connected ? 'emerald' : active ? 'cyan' : 'amber';
  let heading = 'UEFN is closed';
  let summary = 'This project remains linked for catalog editing and saving. Open this same project in UEFN before compiling or importing native textures.';
  let detail = 'Python and the editor connector cannot be checked until UEFN is running.';

  if (connected) {
    heading = 'This project is open and fully connected';
    summary = 'Saving, authoritative compilation, and native Texture2D importing are available.';
    detail = status.autoConnectorInstalled
      ? 'Python is enabled and UEM’s authenticated editor connector is active.'
      : 'The authenticated editor connector is active for this session.';
  } else if (active) {
    heading = 'This project is open, but the editor connector is not attached';
    summary = 'Saving is available, but native Texture2D importing is unavailable until Python connects.';
    detail = !status.pythonEnabled
      ? 'Enable Python Editor Scripting for this project. UEM detects it immediately and attaches automatically.'
      : !status.autoConnectorInstalled
        ? 'UEM could not install its project connector. Confirm that Content/Python is writable, then relink the project.'
        : status.bootstrapState === 'failed'
          ? 'Python is enabled and the connector is installed, but automatic attachment did not complete. Keep UEM open while it retries, or relink the project if the issue continues.'
          : 'Python is enabled and the connector is installed. UEM is attaching it automatically.';
  } else if (status.differentProjectOpen) {
    heading = 'A different project is open in UEFN';
    summary = 'This UEM window is linked to another project. Saving here still targets the linked project, but compilation and native texture importing are unavailable.';
    detail = 'Close or switch the project in UEFN, then open the project linked to this UEM window.';
  } else if (status.uefnRunning) {
    heading = 'UEFN is running without a detected project';
    summary = 'UEM has not detected the linked project as open yet. It may still be loading or UEFN may be at its project browser.';
    detail = 'Open the project linked to this UEM window. Connection will update automatically.';
  }
  return (
    <section className={`mx-auto mb-5 max-w-6xl rounded-2xl border p-4 ${tone === 'emerald' ? 'border-emerald-500/25 bg-emerald-500/5' : tone === 'cyan' ? 'border-cyan-500/25 bg-cyan-500/5' : 'border-amber-500/25 bg-amber-500/5'}`} aria-label="UEFN editor connection">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-300' : tone === 'cyan' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-amber-500/10 text-amber-300'}`}>
          {connected ? <PlugZap className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
        </div>
        <div className="min-w-0 text-xs leading-5 text-slate-300">
          <p className="font-extrabold text-white">{heading}</p>
          <p>{summary}</p>
          <p className={`mt-1 font-semibold ${tone === 'emerald' ? 'text-emerald-200' : tone === 'cyan' ? 'text-cyan-200' : 'text-amber-200'}`}>{detail}</p>
        </div>
      </div>
    </section>
  );
};

export const App: React.FC = () => {
  const desktopHost = isDesktopHost();
  const [config, setConfig] = useState(loadConfig);
  const [entitlements, setEntitlements] = useState(loadEntitlements);
  const [bundles, setBundles] = useState(loadBundles);
  const [storefrontMembership, setStorefrontMembership] = useState(() => loadStorefrontMembership(loadEntitlements(), loadBundles()));
  const [retiredVerseKeys, setRetiredVerseKeys] = useState(loadRetiredVerseKeys);
  const [projectDataDiagnostics, setProjectDataDiagnostics] = useState<string[]>([]);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => snapshot(loadEntitlements(), loadBundles(), loadStorefrontMembership(loadEntitlements(), loadBundles()), loadRetiredVerseKeys(), loadConfig()));
  const [creationChooserRequest, setCreationChooserRequest] = useState(0);
  const [activeViewMode, setActiveViewMode] = useState<'split' | 'catalog' | 'verse'>('catalog');
  const [editingItem, setEditingItem] = useState<EntitlementItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isValidatorOpen, setIsValidatorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EntitlementItem | null>(null);
  const [reloadConfirmationOpen, setReloadConfirmationOpen] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const [switchProjectConfirmationOpen, setSwitchProjectConfirmationOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [status, setStatus] = useState<{ message: string; error?: boolean } | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [editorStatus, setEditorStatus] = useState<EditorStatus | null>(null);
  const [unmanagedTargetFile, setUnmanagedTargetFile] = useState<string | null>(null);
  const [loadedFileRevision, setLoadedFileRevision] = useState<{ fileName: string; contentHash: string | null } | null>(null);

  const validationIssues = useMemo(() => {
    const issues = validateEntireProject(entitlements, bundles, config, storefrontMembership, retiredVerseKeys);
    if (projectDataDiagnostics.length) issues.unshift({
      id: 'project-data-migration', severity: 'warning', ruleName: 'project_data_migration', field: 'verseKey',
      message: `Project data was migrated or normalized while loading. Review: ${projectDataDiagnostics.join(' ')}`,
    });
    if (unmanagedTargetFile === config.targetVerseFileName) issues.unshift({
      id: 'unmanaged-target-file', severity: 'error', ruleName: 'managed_file_required', field: 'targetVerseFileName',
      message: `${unmanagedTargetFile} is not managed by this tool and cannot be overwritten. Choose a new target filename in Settings.`,
    });
    return issues;
  }, [entitlements, bundles, config, storefrontMembership, retiredVerseKeys, projectDataDiagnostics, unmanagedTargetFile]);
  const hasErrors = validationIssues.some(issue => issue.severity === 'error');
  const verseCode = useMemo(() => hasErrors
    ? '# Generation is blocked until the Validation report has no errors.\n'
    : generateVerseCode(entitlements, bundles, config, storefrontMembership, retiredVerseKeys),
  [entitlements, bundles, config, storefrontMembership, retiredVerseKeys, hasErrors]);
  const isFirstOfferSetup = entitlements.length === 0 && validationIssues.filter(issue => issue.severity === 'error').length === 1 && validationIssues.some(issue => issue.ruleName === 'entitlements_min');
  const currentSnapshot = useMemo(() => snapshot(entitlements, bundles, storefrontMembership, retiredVerseKeys, config), [entitlements, bundles, storefrontMembership, retiredVerseKeys, config]);
  const isDirty = currentSnapshot !== lastSavedSnapshot;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey('config'), JSON.stringify({ ...config, contentFolderPath: '' }));
      const clean = cleanManagedData(entitlements, bundles, storefrontMembership, retiredVerseKeys);
      localStorage.setItem(storageKey('entitlements'), JSON.stringify(clean.entitlements));
      localStorage.setItem(storageKey('bundles'), JSON.stringify(clean.bundles));
      localStorage.setItem(storageKey('storefrontMembership'), JSON.stringify(clean.storefrontMembership));
      localStorage.removeItem(storageKey('offerDisplayGroups'));
      localStorage.setItem(storageKey('retiredVerseKeys'), JSON.stringify(retiredVerseKeys));
    } catch {
      setStatus({ message: 'Browser storage is full or unavailable. Export a preset to preserve this session.', error: true });
    }
  }, [config, entitlements, bundles, storefrontMembership, retiredVerseKeys]);

  useEffect(() => {
    let active = true;
    const stopSessionLease = FileService.startSessionLease();
    const initialize = async () => {
      const healthy = await FileService.checkHealth();
      if (!active) return;
      setServerOnline(healthy);
      if (!healthy) {
        setStatus({ message: 'Secure project bridge is unavailable. Use Switch active project to return to the launcher and link the project again.', error: true });
        return;
      }
      setEditorStatus(await FileService.getEditorStatus());
      let loadedEntitlements = entitlements;
      let loadedBundles = bundles;
      let loadedStorefrontMembership = storefrontMembership;
      let loadedRetiredVerseKeys = retiredVerseKeys;
      let loadedProjectDataDiagnostics: string[] = [];
      const result = await FileService.loadVerseFile(config.targetVerseFileName);
      if (result.success && result.content) {
        const parsed = parseVerseCode(result.content);
        if (!parsed.managed || parsed.error) {
          setUnmanagedTargetFile(config.targetVerseFileName);
          setStatus({ message: parsed.error ?? 'Existing Verse was left untouched.', error: true });
          return;
        }
        loadedEntitlements = parsed.entitlements;
        loadedBundles = parsed.bundles;
        loadedStorefrontMembership = parsed.storefrontMembership;
        loadedRetiredVerseKeys = parsed.retiredVerseKeys;
        loadedProjectDataDiagnostics = parsed.projectDataDiagnostics;
        setUnmanagedTargetFile(null);
        setLoadedFileRevision({ fileName: config.targetVerseFileName, contentHash: result.contentHash ?? null });
        setLastSavedSnapshot(snapshot(loadedEntitlements, loadedBundles, loadedStorefrontMembership, loadedRetiredVerseKeys, config));
      } else if (result.status !== 404) {
        setStatus({ message: result.error ?? 'The configured Verse file could not be inspected.', error: true });
        return;
      } else {
        setLoadedFileRevision({ fileName: config.targetVerseFileName, contentHash: null });
      }
      const hydrated = await hydrateProjectImages(loadedEntitlements, loadedBundles, config.assetFolderName);
      if (!active) return;
      setEntitlements(hydrated.entitlements);
      setBundles(hydrated.bundles);
      setStorefrontMembership(loadedStorefrontMembership);
      setRetiredVerseKeys(loadedRetiredVerseKeys);
      setProjectDataDiagnostics(loadedProjectDataDiagnostics);
      const diagnosticNote = loadedProjectDataDiagnostics.length ? ' Review the repaired project-data warning in Validation.' : '';
      setStatus({ message: result.success && result.content
        ? `Loaded ${hydrated.entitlements.length} entitlements and ${hydrated.bundles.length} bundles from ${config.targetVerseFileName}${hydrated.loadedCount ? `, including ${hydrated.loadedCount} project icon${hydrated.loadedCount === 1 ? '' : 's'}` : ''}.${diagnosticNote}`
        : hydrated.loadedCount ? `Loaded ${hydrated.loadedCount} project icon${hydrated.loadedCount === 1 ? '' : 's'} from ${config.assetFolderName}.` : 'No managed Verse file is present yet. Create an offer to begin.' });
    };
    void initialize();
    const heartbeat = window.setInterval(() => void FileService.heartbeat().catch(() => setServerOnline(false)), 20000);
    const editorHeartbeat = window.setInterval(() => void FileService.getEditorStatus().then(result => { if (active) setEditorStatus(result); }), 2000);
    return () => { active = false; window.clearInterval(heartbeat); window.clearInterval(editorHeartbeat); stopSessionLease(); };
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const clearStatusLater = () => window.setTimeout(() => setStatus(null), 6000);

  const saveToDisk = async (): Promise<{ contentHash: string; placeholderDeferred: boolean } | undefined> => {
    if (hasErrors) {
      setStatus({ message: 'Save blocked: resolve validation errors first.', error: true });
      setIsValidatorOpen(true);
      return undefined;
    }
    const placeholderRef = `${config.assetFolderName}.${PLACEHOLDER_ICON_ASSET_NAME}`;
    const needsPlaceholder = entitlements.some(item => item.iconTexture === placeholderRef)
      || bundles.some(bundle => bundle.iconTexture === placeholderRef);
    const placeholderReady = !needsPlaceholder || await FileService.ensurePlaceholderTexture(config.assetFolderName, Boolean(editorStatus?.nativeTextureImportAvailable));
    const placeholderDeferred = needsPlaceholder && !placeholderReady && !editorStatus?.nativeTextureImportAvailable;
    if (needsPlaceholder && !placeholderReady && !placeholderDeferred) {
      setStatus({ message: 'Save blocked: UEFN has not created the placeholder icon in the project. Keep UEFN open and retry.', error: true });
      return undefined;
    }
    setIsSaving(true);
    const existing = await FileService.loadVerseFile(config.targetVerseFileName);
    const knownRevision = loadedFileRevision?.fileName === config.targetVerseFileName ? loadedFileRevision : null;
    if (existing.success && existing.content !== undefined) {
      const parsed = parseVerseCode(existing.content);
      if (!parsed.managed || parsed.error) {
        setUnmanagedTargetFile(config.targetVerseFileName);
        setIsSaving(false);
        setStatus({ message: `${config.targetVerseFileName} contains unmanaged Verse and was not overwritten. Choose a new target filename in Settings.`, error: true });
        return undefined;
      }
      if (!knownRevision) {
        setIsSaving(false);
        setStatus({ message: `${config.targetVerseFileName} already exists. Reload it before saving so its current revision is preserved.`, error: true });
        return undefined;
      }
      if (existing.contentHash !== knownRevision.contentHash) {
        setIsSaving(false);
        setStatus({ message: `${config.targetVerseFileName} changed outside this manager. Reload it before saving.`, error: true });
        return undefined;
      }
    } else if (existing.status !== 404) {
      setIsSaving(false);
      setStatus({ message: `Save preflight failed: ${existing.error ?? 'the existing target could not be inspected.'}`, error: true });
      return undefined;
    } else if (knownRevision?.contentHash) {
      setIsSaving(false);
      setStatus({ message: `${config.targetVerseFileName} was removed outside this manager. Reload the project before saving.`, error: true });
      return undefined;
    }
    setUnmanagedTargetFile(null);
    const result = await FileService.saveVerseFile(config.targetVerseFileName, verseCode, config.autoBackup, knownRevision?.contentHash ?? null);
    setIsSaving(false);
    if (!result.success) {
      setStatus({ message: result.status === 409 ? result.error ?? 'The file changed outside this manager. Reload it before saving.' : `Project save failed: ${result.error ?? 'Unknown bridge error.'}`, error: true });
      return undefined;
    }
    if (!result.contentHash) {
      setStatus({ message: 'Project save was not accepted because the bridge omitted the saved file hash.', error: true });
      return undefined;
    }
    setLoadedFileRevision({ fileName: config.targetVerseFileName, contentHash: result.contentHash });
    setLastSavedSnapshot(currentSnapshot);
    setStatus({ message: placeholderDeferred
      ? `Saved ${result.filePath}. Native placeholder import is still required before compilation.`
      : `Saved ${result.filePath}${result.backupPath ? ' with a verified backup.' : '.'}` });
    clearStatusLater();
    return { contentHash: result.contentHash, placeholderDeferred };
  };

  const performLoadFromDisk = async () => {
    const result = await FileService.loadVerseFile(config.targetVerseFileName);
    if (!result.success || !result.content) return setStatus({ message: result.error ?? 'Verse file could not be loaded.', error: true });
    const parsed = parseVerseCode(result.content);
    if (!parsed.managed || parsed.error) {
      setUnmanagedTargetFile(config.targetVerseFileName);
      return setStatus({ message: parsed.error ?? 'Unmanaged Verse was left untouched.', error: true });
    }
    const hydrated = await hydrateProjectImages(parsed.entitlements, parsed.bundles, config.assetFolderName);
    setEntitlements(hydrated.entitlements);
    setBundles(hydrated.bundles);
    setStorefrontMembership(parsed.storefrontMembership);
    setRetiredVerseKeys(parsed.retiredVerseKeys);
    setProjectDataDiagnostics(parsed.projectDataDiagnostics);
    setUnmanagedTargetFile(null);
    setLoadedFileRevision({ fileName: config.targetVerseFileName, contentHash: result.contentHash ?? null });
    setLastSavedSnapshot(snapshot(hydrated.entitlements, hydrated.bundles, parsed.storefrontMembership, parsed.retiredVerseKeys, config));
    const diagnosticNote = parsed.projectDataDiagnostics.length ? ' Review the repaired project-data warning in Validation.' : '';
    setStatus({ message: `Loaded ${hydrated.entitlements.length} entitlements and ${hydrated.bundles.length} bundles${hydrated.loadedCount ? `, including ${hydrated.loadedCount} project icon${hydrated.loadedCount === 1 ? '' : 's'}` : ''}.${diagnosticNote}` });
  };

  const loadFromDisk = async () => {
    if (isDirty) {
      setReloadConfirmationOpen(true);
      return;
    }
    await performLoadFromDisk();
  };

  const compileVerse = async () => {
    if (!config.enableVerseWorkflowServer) {
      setStatus({ message: 'Verse Workflow Server compilation is disabled in Project Settings.', error: true });
      return;
    }
    const saved = await saveToDisk();
    if (!saved) return;
    if (saved.placeholderDeferred) {
      setStatus({ message: 'Verse was saved, but compilation is waiting for the default Texture2D. Complete the automatic connector guidance shown above, then try Save & Compile again.', error: true });
      return;
    }
    setIsCompiling(true);
    const result = await FileService.triggerVerseCompilation(config.targetVerseFileName, saved.contentHash);
    setIsCompiling(false);
    if (result.success) {
      setStatus({ message: `Compiled ${result.fileName ?? config.targetVerseFileName} in ${result.assetMount ?? 'the verified UEFN project'} with ${result.numErrors ?? 0} errors and ${result.numWarnings ?? 0} warnings.` });
    } else {
      setStatus({ message: result.error ?? 'Verse compilation was not verified.', error: true });
    }
  };

  const addPreset = (index: number) => {
    const normalized = normalizeEntitlement(DEFAULT_PRESETS[index % DEFAULT_PRESETS.length], index);
    const verseKey = allocateProjectVerseKey(normalized.name, entitlements, bundles, storefrontMembership, retiredVerseKeys);
    setEditingItem({ ...normalized, id: `new-${crypto.randomUUID()}`, verseKey, iconTexture: `${config.assetFolderName}.${PLACEHOLDER_ICON_ASSET_NAME}`, iconImageData: undefined, iconFileName: undefined });
    setIsModalOpen(true);
  };

  const importPreset = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        const data = parseManagedData(raw);
        const nextConfig = normalizeProjectConfig(raw?.config, config);
        setEntitlements(data.entitlements);
        setBundles(data.bundles);
        setStorefrontMembership(data.storefrontMembership);
        setRetiredVerseKeys(data.retiredVerseKeys);
        setProjectDataDiagnostics([...new Set([...data.projectDataDiagnostics, ...legacyProjectConfigDiagnostics(raw)])]);
        setConfig(nextConfig);
        setStatus({ message: `Imported ${data.entitlements.length} entitlements, ${data.bundles.length} bundles, and ${data.storefrontMembership.focused.length} focused storefronts. Review validation before saving.` });
      } catch (error) {
        setStatus({ message: error instanceof Error ? `Preset rejected: ${error.message}` : 'Preset JSON is invalid.', error: true });
      }
    };
    reader.onerror = () => setStatus({ message: 'Preset file could not be read.', error: true });
    reader.readAsText(file);
  };

  const addNew = () => {
    const index = entitlements.length + 1;
    setEditingItem(normalizeEntitlement({
      id: `new-${crypto.randomUUID()}`, verseKey: `item_${index}`, name: '',
      shortDescription: '', description: '',
      iconTexture: `${config.assetFolderName}.${PLACEHOLDER_ICON_ASSET_NAME}`,
    }, index));
    setIsModalOpen(true);
  };

  const saveModalItem = (item: EntitlementItem) => {
    const isDraft = item.id.startsWith('new-');
    const previousItem = entitlements.find(existing => existing.id === item.id);
    const allocator = createVerseKeyAllocator(collectManagedVerseKeys(entitlements, bundles, storefrontMembership.focused), retiredVerseKeys);
    const shouldAllocateDraftKey = isDraft && item.verseKey === sanitizeVerseIdentifier(item.name);
    const draftVerseKey = shouldAllocateDraftKey ? allocator.allocate(item.name) : item.verseKey;
    if (!shouldAllocateDraftKey && isDraft) allocator.reserveExisting(item.verseKey);
    const persistedId = isDraft ? `ent-${crypto.randomUUID()}` : item.id;
    const persistedItem = {
      ...item,
      id: persistedId,
      verseKey: draftVerseKey,
      triggers: { ...item.triggers },
      alternateOffers: (item.alternateOffers ?? []).map(offer => {
        const isNewAlternate = offer.id.startsWith('new-alt-');
        const verseKey = isNewAlternate ? allocator.allocateAlternate(draftVerseKey) : offer.verseKey;
        return { ...offer, id: isNewAlternate ? `offer-${crypto.randomUUID()}` : offer.id, verseKey };
      }),
    };
    const retired = [
      ...(previousItem && previousItem.verseKey !== persistedItem.verseKey ? [previousItem.verseKey] : []),
      ...(previousItem?.alternateOffers ?? []).flatMap(previousOffer => {
        const nextOffer = persistedItem.alternateOffers?.find(offer => offer.id === previousOffer.id);
        return !nextOffer || nextOffer.verseKey !== previousOffer.verseKey ? [previousOffer.verseKey] : [];
      }),
    ];
    if (retired.length) setRetiredVerseKeys(keys => addRetiredVerseKeys(keys, retired));
    setEntitlements(items => items.some(existing => existing.id === item.id) ? items.map(existing => existing.id === item.id ? persistedItem : existing) : [...items, persistedItem]);
    const validOfferKeys = new Set([persistedItem.verseKey, ...(persistedItem.alternateOffers ?? []).map(offer => offer.verseKey)]);
    setStorefrontMembership(current => ({
      allOffers: [
        ...current.allOffers
          .map(entry => entry.entitlementId === item.id ? { ...entry, entitlementId: persistedItem.id } : entry)
          .filter(entry => entry.entitlementId !== persistedItem.id || !entry.offerVerseKey || validOfferKeys.has(entry.offerVerseKey)),
        ...(isDraft && !current.allOffers.some(entry => entry.entitlementId === persistedItem.id) ? [{ entitlementId: persistedItem.id }] : []),
      ],
      focused: current.focused.map(group => ({
        ...group,
        entries: group.entries.map(entry => entry.entitlementId === item.id ? { ...entry, entitlementId: persistedItem.id } : entry).filter(entry => entry.entitlementId !== persistedItem.id || !entry.offerVerseKey || validOfferKeys.has(entry.offerVerseKey)),
      })),
    }));
    setIsModalOpen(false);
    setEditingItem(null);
  };

  const deleteItem = (item: EntitlementItem) => {
    setRetiredVerseKeys(keys => addRetiredVerseKeys(keys, [item.verseKey, ...(item.alternateOffers ?? []).map(offer => offer.verseKey)]));
    setEntitlements(items => items.filter(candidate => candidate.id !== item.id));
    setBundles(items => items.map(bundle => ({ ...bundle, items: bundle.items.filter(entry => entry.entitlementId !== item.id) })));
    setStorefrontMembership(current => ({
      allOffers: current.allOffers.filter(entry => entry.entitlementId !== item.id),
      focused: current.focused.map(group => ({ ...group, entries: group.entries.filter(entry => entry.entitlementId !== item.id) })),
    }));
    setPendingDelete(null);
  };

  const listProps = {
    entitlements, bundles, creationRequest: creationChooserRequest, onAddNew: addNew, onAddPreset: addPreset,
    onEdit: (item: EntitlementItem) => { setEditingItem(item); setIsModalOpen(true); },
    onDuplicate: (item: EntitlementItem) => {
      const copy = duplicateEntitlement(item, entitlements, bundles, crypto.randomUUID, storefrontMembership.focused);
      setEntitlements(items => [...items, copy]);
      setStorefrontMembership(current => ({ ...current, allOffers: current.allOffers.some(entry => entry.entitlementId === copy.id) ? current.allOffers : [...current.allOffers, { entitlementId: copy.id }] }));
    },
    onDelete: (id: string) => setPendingDelete(entitlements.find(item => item.id === id) ?? null),
  };

  const requestOfferCreation = () => setCreationChooserRequest(request => request + 1);
  const updateBundles = (nextBundles: BundleOffer[]) => {
    const existingById = new Map(bundles.map(bundle => [bundle.id, bundle]));
    const allocator = createVerseKeyAllocator(collectManagedVerseKeys(entitlements, bundles, storefrontMembership.focused), retiredVerseKeys);
    const finalizedBundles = nextBundles.map(bundle => {
      const isNew = !existingById.has(bundle.id);
      const shouldAllocate = isNew && bundle.verseKey === sanitizeVerseIdentifier(bundle.name);
      return shouldAllocate ? { ...bundle, verseKey: allocator.allocate(bundle.name) } : bundle;
    });
    const retired = bundles.flatMap(previous => {
      const next = finalizedBundles.find(candidate => candidate.id === previous.id);
      return !next || next.verseKey !== previous.verseKey ? [previous.verseKey] : [];
    });
    if (retired.length) setRetiredVerseKeys(keys => addRetiredVerseKeys(keys, retired));
    const validBundleIds = new Set(finalizedBundles.map(bundle => bundle.id));
    setBundles(finalizedBundles);
    const previouslyKnownIds = new Set(bundles.map(bundle => bundle.id));
    const newlyCreatedStatic = finalizedBundles.filter(bundle => !previouslyKnownIds.has(bundle.id) && !bundle.dynamicRemaining).map(bundle => ({ bundleId: bundle.id }));
    setStorefrontMembership(current => ({
      allOffers: [...current.allOffers.filter(entry => !entry.bundleId || validBundleIds.has(entry.bundleId)), ...newlyCreatedStatic],
      focused: current.focused.map(group => ({ ...group, entries: group.entries.filter(entry => !entry.bundleId || validBundleIds.has(entry.bundleId)) })),
    }));
  };

  const duplicateBundle = (bundle: BundleOffer) => {
    const allocator = createVerseKeyAllocator(collectManagedVerseKeys(entitlements, bundles, storefrontMembership.focused), retiredVerseKeys);
    const copy: BundleOffer = {
      ...bundle,
      id: `bundle-${crypto.randomUUID()}`,
      verseKey: allocator.allocate(`${bundle.name} Copy`),
      name: `${bundle.name} Copy`,
      items: bundle.items.map(entry => ({ ...entry })),
      restrictions: bundle.restrictions ? { ...bundle.restrictions, blockedCountryCodes: [...bundle.restrictions.blockedCountryCodes], blockedPlatformFamilies: [...bundle.restrictions.blockedPlatformFamilies] } : undefined,
    };
    setBundles(current => [...current, copy]);
    if (!copy.dynamicRemaining) setStorefrontMembership(current => ({ ...current, allOffers: [...current.allOffers, { bundleId: copy.id }] }));
  };

  const allocateNewVerseKey = (name: string) => allocateProjectVerseKey(name, entitlements, bundles, storefrontMembership, retiredVerseKeys);
  const updateStorefrontMembership = (nextMembership: StorefrontMembership) => {
    const existingById = new Map(storefrontMembership.focused.map(group => [group.id, group]));
    const allocator = createVerseKeyAllocator(collectManagedVerseKeys(entitlements, bundles, storefrontMembership.focused), retiredVerseKeys);
    const finalizedGroups = nextMembership.focused.map(group => {
      const isNew = !existingById.has(group.id);
      const shouldAllocate = isNew && group.verseKey === sanitizeVerseIdentifier(group.name);
      if (!shouldAllocate) return group;
      const nextKey = allocator.allocate(group.name);
      return { ...group, verseKey: nextKey };
    });
    const retired = storefrontMembership.focused.flatMap(previous => {
      const next = finalizedGroups.find(candidate => candidate.id === previous.id);
      return !next || next.verseKey !== previous.verseKey ? [previous.verseKey] : [];
    });
    if (retired.length) setRetiredVerseKeys(keys => addRetiredVerseKeys(keys, retired));
    setStorefrontMembership({ allOffers: nextMembership.allOffers, focused: finalizedGroups });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080c14] text-slate-100">
      <DesktopTitleBar dirty={isDirty} onRequestClose={() => isDirty ? setCloseConfirmationOpen(true) : postDesktopWindowAction('close')} />
      <Header
        config={config} onUpdateConfig={setConfig} onSaveToDisk={() => void saveToDisk()} onLoadFromDisk={() => void loadFromDisk()}
        onCompileVerse={() => void compileVerse()} onExportPreset={() => FileService.exportPresetJson({ config, ...cleanManagedData(entitlements, bundles, storefrontMembership, retiredVerseKeys) })}
        onImportPreset={importPreset} onOpenSettings={() => setIsSettingsOpen(true)} onOpenValidator={() => setIsValidatorOpen(true)}
        onSwitchProject={() => isDirty ? setSwitchProjectConfirmationOpen(true) : postDesktopWindowAction('switch-project')}
        validationIssues={validationIssues} isSaving={isSaving} isCompiling={isCompiling} saveStatusMessage={status?.message ?? null}
        saveStatusIsError={Boolean(status?.error)} serverOnline={serverOnline} hasValidationErrors={hasErrors} isDirty={isDirty} entitlementCount={entitlements.length} desktopHost={desktopHost}
      />

      <div className="px-4 lg:px-8 py-2.5 bg-[#090e1a] border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-400">Workspace:</span><div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl">
          {([['catalog', Layers, 'Catalog'], ['split', Columns, 'Catalog + Verse'], ['verse', FileCode, 'Verse']] as const).map(([mode, Icon, label]) => <button key={mode} type="button" onClick={() => setActiveViewMode(mode)} aria-pressed={activeViewMode === mode} className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg ${activeViewMode === mode ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}><Icon className="w-3.5 h-3.5" />{label}</button>)}
          <button type="button" aria-haspopup="dialog" onClick={() => setIsSetupOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-cyan-300"><BookOpenCheck className="h-3.5 w-3.5" />Need Help?</button>
        </div></div>
        <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400"><span>Icon folder: <code className="text-cyan-300">Content/{config.assetFolderName}/</code></span></div>
      </div>

      <main className="flex-1 px-4 lg:px-8 py-6">
        <EditorCapabilityNotice status={editorStatus} />
        {entitlements.length === 0 && <SetupGuide bridgeConnected={serverOnline} onCreateEntitlement={requestOfferCreation} />}
        {activeViewMode === 'split' ? <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start"><div className="xl:col-span-7 space-y-8"><EntitlementList {...listProps} />{entitlements.length > 0 && <><BundleManager bundles={bundles} entitlements={entitlements} assetFolderName={config.assetFolderName} allocateVerseKey={allocateNewVerseKey} onChange={updateBundles} onDuplicate={duplicateBundle} /><OfferDisplayManager membership={storefrontMembership} entitlements={entitlements} bundles={bundles} allocateVerseKey={allocateNewVerseKey} onChange={updateStorefrontMembership} /></>}</div><div className="xl:col-span-5 sticky top-20 h-[calc(100vh-140px)]"><VersePreview verseCode={verseCode} config={config} entitlements={entitlements} storefrontMembership={storefrontMembership} onSaveToDisk={() => void saveToDisk()} isSaving={isSaving} hasErrors={hasErrors} /></div></div>
          : activeViewMode === 'catalog' ? <div className="max-w-6xl mx-auto space-y-8"><EntitlementList {...listProps} />{entitlements.length > 0 && <><BundleManager bundles={bundles} entitlements={entitlements} assetFolderName={config.assetFolderName} allocateVerseKey={allocateNewVerseKey} onChange={updateBundles} onDuplicate={duplicateBundle} /><OfferDisplayManager membership={storefrontMembership} entitlements={entitlements} bundles={bundles} allocateVerseKey={allocateNewVerseKey} onChange={updateStorefrontMembership} /></>}</div>
          : <div className="max-w-6xl mx-auto h-[calc(100vh-150px)]"><VersePreview verseCode={verseCode} config={config} entitlements={entitlements} storefrontMembership={storefrontMembership} onSaveToDisk={() => void saveToDisk()} isSaving={isSaving} hasErrors={hasErrors} /></div>}
      </main>

      <EntitlementModal isOpen={isModalOpen} item={editingItem} contentFolderPath={config.contentFolderPath} assetFolderName={config.assetFolderName} allEntitlements={entitlements} editorStatus={editorStatus} onSave={saveModalItem} onClose={() => { setIsModalOpen(false); setEditingItem(null); }} />
      <ValidationReportModal isOpen={isValidatorOpen} issues={validationIssues} entitlements={entitlements} isSetupIncomplete={isFirstOfferSetup} onCreateEntitlement={requestOfferCreation} onOpenSettings={() => setIsSettingsOpen(true)} onSelectEntitlement={item => { setEditingItem(item); setIsModalOpen(true); }} onClose={() => setIsValidatorOpen(false)} />
      <ProjectSettingsModal isOpen={isSettingsOpen} config={config} onSaveConfig={setConfig} onClose={() => setIsSettingsOpen(false)} />
      <SetupModal open={isSetupOpen} onClose={() => setIsSetupOpen(false)} config={config} entitlements={entitlements} storefrontMembership={storefrontMembership} />
      <ConfirmDialog open={Boolean(pendingDelete)} title={`Delete ${pendingDelete?.name ?? 'offer'}?`} description={<>This offer and its entitlement definition will also be removed from every bundle and focused storefront. The project file remains unchanged until you save.</>} confirmLabel="Delete offer" onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) deleteItem(pendingDelete); }} />
      <ConfirmDialog open={reloadConfirmationOpen} tone="warning" title="Reload from the project?" description={<>Reloading replaces the unsaved catalog, bundles, and offer displays currently in this manager with the last saved project version.</>} confirmLabel="Discard changes and reload" onCancel={() => setReloadConfirmationOpen(false)} onConfirm={() => { setReloadConfirmationOpen(false); void performLoadFromDisk(); }} />
      <ConfirmDialog open={closeConfirmationOpen} tone="warning" title="Close with unsaved changes?" description={<>Your current changes have not been written to the UEFN project. Closing now discards this unsaved manager session.</>} confirmLabel="Discard changes and close" onCancel={() => setCloseConfirmationOpen(false)} onConfirm={() => postDesktopWindowAction('close')} />
      <ConfirmDialog open={switchProjectConfirmationOpen} tone="warning" title="Switch projects with unsaved changes?" description={<>Your current changes have not been written to this UEFN project. Returning to the launcher now discards this unsaved manager session.</>} confirmLabel="Discard changes and switch" onCancel={() => setSwitchProjectConfirmationOpen(false)} onConfirm={() => postDesktopWindowAction('switch-project')} />
    </div>
  );
};

export default App;
