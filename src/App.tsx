import React, { useState, useEffect, useMemo } from 'react';
import { 
  Header 
} from './components/Header';
import { 
  EntitlementList 
} from './components/EntitlementList';
import { 
  EntitlementModal 
} from './components/EntitlementModal';
import { 
  VersePreview 
} from './components/VersePreview';
import { 
  SimulatorModal 
} from './components/SimulatorModal';
import { 
  ValidationReportModal 
} from './components/ValidationReportModal';
import { 
  ProjectSettingsModal 
} from './components/ProjectSettingsModal';
import { 
  EntitlementItem, 
  BundleOffer, 
  ProjectConfig 
} from './types/entitlement';
import { DEFAULT_PRESETS } from './constants/presets';
import { generateVerseCode } from './services/verseGenerator';
import { parseVerseCode } from './services/verseParser';
import { validateEntireProject } from './services/validator';
import { FileService } from './services/fileService';
import { Layers, FileCode, Columns } from 'lucide-react';

const DEFAULT_CONFIG: ProjectConfig = {
  contentFolderPath: 'C:\\Users\\brann\\Documents\\UEFN Projects\\TaB\\Content',
  targetVerseFileName: 'managed_transactions.verse',
  assetFolderName: 'EntitlementIcons',
  deviceClassName: 'managed_transactions_device',
  infoModuleName: 'ManagedEntitlementInfo',
  entitlementsModuleName: 'ManagedEntitlements',
  pricesModuleName: 'ManagedTransactionPrices',
  offersModuleName: 'ManagedOffers',
  autoBackup: true,
  enableVerseWorkflowServer: true,
};

export const App: React.FC = () => {
  // Config & State with synchronous URL param override
  const [config, setConfig] = useState<ProjectConfig>(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const contentDirParam = params?.get('contentDir') || params?.get('project');
    const assetFolderParam = params?.get('assetFolder');
    const verseFileParam = params?.get('verseFile');

    const saved = localStorage.getItem('uefn_entitlement_config');
    let initial: ProjectConfig = saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;

    // URL parameters have top priority
    if (contentDirParam) {
      initial = {
        ...initial,
        contentFolderPath: decodeURIComponent(contentDirParam),
        assetFolderName: assetFolderParam ? decodeURIComponent(assetFolderParam) : initial.assetFolderName,
        targetVerseFileName: verseFileParam ? decodeURIComponent(verseFileParam) : initial.targetVerseFileName,
      };
    }
    return initial;
  });

  const [entitlements, setEntitlements] = useState<EntitlementItem[]>(() => {
    const saved = localStorage.getItem('uefn_entitlements_items');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    // Initialize with rich default presets
    return DEFAULT_PRESETS.map((p, idx) => ({
      id: `ent-${Date.now()}-${idx}`,
      verseKey: p.verseKey || `item_${idx}`,
      name: p.name || 'Entitlement',
      shortDescription: p.shortDescription || '',
      description: p.description || '',
      priceVBucks: p.priceVBucks || 100,
      itemType: p.itemType || 'durable',
      maxCount: p.maxCount || 1,
      autoConsume: p.autoConsume ?? false,
      iconTexture: p.iconTexture || `EntitlementIcons.${p.verseKey}`,
      flags: p.flags || { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
      ageAndRegion: p.ageAndRegion || { enabled: false, minAge: 0, allowedCountryCodes: [], disallowedCountryCodes: [] },
      actionHook: p.actionHook || { type: 'signal_event', eventName: `${p.verseKey}_PurchasedEvent` },
      cancelHook: p.cancelHook || { notifyPlayer: false },
      rejoinHook: p.rejoinHook || { autoRestore: p.itemType === 'durable' },
      triggers: p.triggers || { generateButtonBinding: false, generateZoneBinding: false, generateAsyncListener: false },
    }));
  });

  const [bundles, setBundles] = useState<BundleOffer[]>([]);
  const [activeViewMode, setActiveViewMode] = useState<'split' | 'catalog' | 'verse'>('split');
  
  // Modals state
  const [editingItem, setEditingItem] = useState<EntitlementItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simulatorItem, setSimulatorItem] = useState<EntitlementItem | null>(null);
  const [isValidatorOpen, setIsValidatorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // IO Status state
  const [isSaving, setIsSaving] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState(true);

  // Save to LocalStorage
  useEffect(() => {
    localStorage.setItem('uefn_entitlement_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem('uefn_entitlements_items', JSON.stringify(entitlements));
  }, [entitlements]);

  // Check backend server health and handle URL query params on mount
  useEffect(() => {
    FileService.checkHealth().then(isHealthy => setServerOnline(isHealthy));

    const params = new URLSearchParams(window.location.search);
    const contentDirParam = params.get('contentDir') || params.get('project');
    const assetFolderParam = params.get('assetFolder');
    const verseFileParam = params.get('verseFile');

    const activeContentDir = contentDirParam ? decodeURIComponent(contentDirParam) : config.contentFolderPath;
    if (activeContentDir) {
      const cleanDir = activeContentDir.replace(/[/\\]+$/, '');
      const primaryFile = `${cleanDir}\\${verseFileParam || config.targetVerseFileName || 'managed_transactions.verse'}`;
      const fallbackFile = `${cleanDir}\\in_island_transactions.verse`;

      // Try loading primary file first
      FileService.loadVerseFile(primaryFile).then(res => {
        if (res.success && res.content) {
          const parsed = parseVerseCode(res.content);
          if (parsed.entitlements.length > 0) {
            setEntitlements(parsed.entitlements);
            if (parsed.bundles.length > 0) setBundles(parsed.bundles);
            setSaveStatusMessage(`Auto-loaded ${parsed.entitlements.length} entitlements from ${config.targetVerseFileName}!`);
            setTimeout(() => setSaveStatusMessage(null), 5000);
            return;
          }
        }

        // Fallback: If managed_transactions.verse is not yet created, import from in_island_transactions.verse
        FileService.loadVerseFile(fallbackFile).then(fallbackRes => {
          if (fallbackRes.success && fallbackRes.content) {
            const parsed = parseVerseCode(fallbackRes.content);
            if (parsed.entitlements.length > 0) {
              setEntitlements(parsed.entitlements);
              if (parsed.bundles.length > 0) setBundles(parsed.bundles);
              setSaveStatusMessage(`Imported ${parsed.entitlements.length} entitlements from existing in_island_transactions.verse!`);
              setTimeout(() => setSaveStatusMessage(null), 5000);
            }
          }
        });
      });
    }
  }, []);

  // Compute live Verse code
  const verseCode = useMemo(() => {
    return generateVerseCode(entitlements, bundles, config);
  }, [entitlements, bundles, config]);


  // Compute live validation issues
  const validationIssues = useMemo(() => {
    return validateEntireProject(entitlements, bundles);
  }, [entitlements, bundles]);

  // Save to project disk file
  const handleSaveToDisk = async () => {
    setIsSaving(true);
    setSaveStatusMessage(null);

    const targetPath = `${config.contentFolderPath.replace(/[/\\]+$/, '')}\\${config.targetVerseFileName}`;
    const result = await FileService.saveVerseFile(targetPath, verseCode, config.autoBackup);

    if (result.success) {
      setSaveStatusMessage(`Successfully written to ${targetPath}`);
      setTimeout(() => setSaveStatusMessage(null), 5000);
    } else {
      // Fallback: trigger direct browser download
      FileService.downloadVerseFile(config.targetVerseFileName, verseCode);
      setSaveStatusMessage(`Downloaded ${config.targetVerseFileName} to downloads folder.`);
      setTimeout(() => setSaveStatusMessage(null), 5000);
    }
    setIsSaving(false);
  };

  // Load from project disk file
  const handleLoadFromDisk = async () => {
    const targetPath = `${config.contentFolderPath.replace(/[/\\]+$/, '')}\\${config.targetVerseFileName}`;
    const result = await FileService.loadVerseFile(targetPath);

    if (result.success && result.content) {
      const parsed = parseVerseCode(result.content);
      if (parsed.entitlements.length > 0) {
        setEntitlements(parsed.entitlements);
        setBundles(parsed.bundles);
        setSaveStatusMessage(`Loaded ${parsed.entitlements.length} entitlements from ${targetPath}`);
        setTimeout(() => setSaveStatusMessage(null), 5000);
      } else {
        alert(`Read file from ${targetPath}, but no standard Entitlement definitions were found.`);
      }
    } else {
      alert(`Could not load file from ${targetPath}. Please verify the path in Settings.`);
    }
  };

  // Compile Verse via Verse Workflow Server
  const handleCompileVerse = async () => {
    setIsCompiling(true);
    const result = await FileService.triggerVerseCompilation();
    setIsCompiling(false);

    if (result.success) {
      setSaveStatusMessage('Verse compilation triggered in UEFN Editor!');
      setTimeout(() => setSaveStatusMessage(null), 4000);
    } else {
      alert(`Verse Compilation Notice:\n${result.error || 'Please ensure UEFN is running with the project open on port 1962.'}`);
    }
  };

  // Preset operations
  const handleAddPreset = (index: number) => {
    const preset = DEFAULT_PRESETS[index % DEFAULT_PRESETS.length];
    const newItem: EntitlementItem = {
      id: `ent-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      verseKey: `${preset.verseKey}_${entitlements.length + 1}`,
      name: preset.name || 'New Item',
      shortDescription: preset.shortDescription || '',
      description: preset.description || '',
      priceVBucks: preset.priceVBucks || 100,
      itemType: preset.itemType || 'durable',
      maxCount: preset.maxCount || 1,
      autoConsume: preset.autoConsume ?? false,
      iconTexture: preset.iconTexture || `EntitlementIcons.${preset.verseKey}`,
      flags: preset.flags || { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
      ageAndRegion: preset.ageAndRegion || { enabled: false, minAge: 0, allowedCountryCodes: [], disallowedCountryCodes: [] },
      actionHook: preset.actionHook || { type: 'signal_event', eventName: `${preset.verseKey}_PurchasedEvent` },
      cancelHook: preset.cancelHook || { notifyPlayer: false },
      rejoinHook: preset.rejoinHook || { autoRestore: preset.itemType === 'durable' },
      triggers: preset.triggers || { generateButtonBinding: false, generateZoneBinding: false, generateAsyncListener: false },
    };
    setEntitlements(prev => [...prev, newItem]);
  };

  // Export JSON Preset
  const handleExportPreset = () => {
    FileService.exportPresetJson({ config, entitlements, bundles });
  };

  // Import JSON Preset
  const handleImportPreset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.entitlements && Array.isArray(data.entitlements)) {
          setEntitlements(data.entitlements);
          if (data.config) setConfig(data.config);
          if (data.bundles) setBundles(data.bundles);
          setSaveStatusMessage(`Imported ${data.entitlements.length} entitlements from preset.`);
          setTimeout(() => setSaveStatusMessage(null), 4000);
        }
      } catch {
        alert('Invalid preset JSON file.');
      }
    };
    reader.readAsText(file);
  };

  // New Item creation
  const handleAddNew = () => {
    const defaultKey = `item_${entitlements.length + 1}`;
    const newItem: EntitlementItem = {
      id: `new-${Date.now()}`,
      verseKey: defaultKey,
      name: `New Entitlement ${entitlements.length + 1}`,
      shortDescription: '',
      description: '',
      priceVBucks: 100,
      itemType: 'durable',
      maxCount: 1,
      autoConsume: false,
      iconTexture: `${config.assetFolderName || 'EntitlementIcons'}.${defaultKey}`,
      flags: {
        paidRandomItem: false,
        paidRandomItemOdds: '',
        paidArea: false,
        consequentialToGameplay: true,
      },
      ageAndRegion: {
        enabled: false,
        minAge: 0,
        allowedCountryCodes: [],
        disallowedCountryCodes: [],
      },
      actionHook: {
        type: 'signal_event',
        eventName: `${defaultKey}_PurchasedEvent`,
      },
      cancelHook: {
        notifyPlayer: false,
      },
      rejoinHook: {
        autoRestore: true,
      },
      triggers: {
        generateButtonBinding: false,
        generateZoneBinding: false,
        generateAsyncListener: false,
      },
    };
    setEditingItem(newItem);
    setIsModalOpen(true);
  };

  // Edit Item
  const handleEdit = (item: EntitlementItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  // Duplicate Item
  const handleDuplicate = (item: EntitlementItem) => {
    const clone: EntitlementItem = {
      ...item,
      id: `ent-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      verseKey: `${item.verseKey}_copy`,
      name: `${item.name} (Copy)`,
    };
    setEntitlements(prev => [...prev, clone]);
  };

  // Delete Item
  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this entitlement?')) {
      setEntitlements(prev => prev.filter(item => item.id !== id));
    }
  };

  // Save Item from modal
  const handleSaveModalItem = (item: EntitlementItem) => {
    setEntitlements(prev => {
      const exists = prev.some(e => e.id === item.id);
      if (exists) {
        return prev.map(e => (e.id === item.id ? item : e));
      }
      return [...prev, item];
    });
    setIsModalOpen(false);
    setEditingItem(null);
  };

  // Test Purchase in Sandbox
  const handleTestPurchase = (item: EntitlementItem) => {
    setSimulatorItem(item);
    setIsSimulatorOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080c14] text-slate-100">
      
      {/* Top Header Navigation */}
      <Header
        config={config}
        onUpdateConfig={setConfig}
        onSaveToDisk={handleSaveToDisk}
        onLoadFromDisk={handleLoadFromDisk}
        onCompileVerse={handleCompileVerse}
        onExportPreset={handleExportPreset}
        onImportPreset={handleImportPreset}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenSimulator={() => { setSimulatorItem(null); setIsSimulatorOpen(true); }}
        onOpenValidator={() => setIsValidatorOpen(true)}
        validationIssues={validationIssues}
        isSaving={isSaving}
        isCompiling={isCompiling}
        saveStatusMessage={saveStatusMessage}
        serverOnline={serverOnline}
      />

      {/* Main Workspace Bar (View Mode Toggles) */}
      <div className="px-4 lg:px-8 py-2.5 bg-[#090e1a] border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400">View Layout:</span>
          <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveViewMode('split')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                activeViewMode === 'split'
                  ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Split Studio</span>
            </button>

            <button
              onClick={() => setActiveViewMode('catalog')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                activeViewMode === 'catalog'
                  ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Catalog Only</span>
            </button>

            <button
              onClick={() => setActiveViewMode('verse')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                activeViewMode === 'verse'
                  ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Verse Code Only</span>
            </button>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400">
          <span>Public Asset Folder: <code className="text-cyan-300 font-mono">Content/{config.assetFolderName}/</code></span>
        </div>
      </div>

      {/* Main Workspace Body */}
      <main className="flex-1 px-4 lg:px-8 py-6 overflow-hidden">
        {activeViewMode === 'split' ? (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full items-start">
            
            {/* Left 7 cols: Catalog Manager */}
            <div className="xl:col-span-7">
              <EntitlementList
                entitlements={entitlements}
                bundles={bundles}
                onAddNew={handleAddNew}
                onAddPreset={handleAddPreset}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onTestPurchase={handleTestPurchase}
              />
            </div>

            {/* Right 5 cols: Live Verse Preview */}
            <div className="xl:col-span-5 sticky top-20 h-[calc(100vh-140px)]">
              <VersePreview
                verseCode={verseCode}
                config={config}
                onSaveToDisk={handleSaveToDisk}
                isSaving={isSaving}
              />
            </div>
          </div>
        ) : activeViewMode === 'catalog' ? (
          <div className="max-w-6xl mx-auto">
            <EntitlementList
              entitlements={entitlements}
              bundles={bundles}
              onAddNew={handleAddNew}
              onAddPreset={handleAddPreset}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onTestPurchase={handleTestPurchase}
            />
          </div>
        ) : (
          <div className="max-w-6xl mx-auto h-[calc(100vh-150px)]">
            <VersePreview
              verseCode={verseCode}
              config={config}
              onSaveToDisk={handleSaveToDisk}
              isSaving={isSaving}
            />
          </div>
        )}
      </main>

      {/* Modals & Dialogs */}
      <EntitlementModal
        isOpen={isModalOpen}
        item={editingItem}
        contentFolderPath={config.contentFolderPath}
        assetFolderName={config.assetFolderName}
        allEntitlements={entitlements}
        onSave={handleSaveModalItem}
        onClose={() => { setIsModalOpen(false); setEditingItem(null); }}
      />

      <SimulatorModal
        isOpen={isSimulatorOpen}
        entitlements={entitlements}
        initialSelectedItem={simulatorItem}
        onClose={() => setIsSimulatorOpen(false)}
      />

      <ValidationReportModal
        isOpen={isValidatorOpen}
        issues={validationIssues}
        entitlements={entitlements}
        onSelectEntitlement={(item) => { handleEdit(item); }}
        onClose={() => setIsValidatorOpen(false)}
      />

      <ProjectSettingsModal
        isOpen={isSettingsOpen}
        config={config}
        onSaveConfig={setConfig}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default App;
