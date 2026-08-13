import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Upload, Image as ImageIcon, CheckCircle, AlertCircle, RefreshCw, Layers, Check, X } from 'lucide-react';
import { FileService } from '../services/fileService';

interface ImageUploadZoneProps {
  contentFolderPath: string;
  assetFolderName: string;
  assetName: string;
  currentTextureRef: string;
  currentImageData?: string;
  onTextureRefChange: (ref: string) => void;
  onImageDataChange: (base64: string, fileName?: string) => void;
  onPendingStateChange: (pending: boolean) => void;
}

export interface ConfirmedTextureImport {
  preview: string;
  fileName: string;
  verseAssetPath: string;
  assetObjectPath?: string;
}

export interface ImageUploadZoneHandle {
  confirmPendingImport: () => Promise<ConfirmedTextureImport | null>;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXTURE_DIMENSION = 4096;

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function powerOfTwoCanvasSize(value: number): number {
  if (value >= MAX_TEXTURE_DIMENSION) return MAX_TEXTURE_DIMENSION;
  return 2 ** Math.ceil(Math.log2(value));
}

function readImagePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('PNG preview could not be read.'));
    reader.readAsDataURL(file);
  });
}

async function createPowerOfTwoPreview(file: File): Promise<{ preview: string; message: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const width = powerOfTwoCanvasSize(bitmap.width);
    const height = powerOfTwoCanvasSize(bitmap.height);
    if (isPowerOfTwo(bitmap.width) && isPowerOfTwo(bitmap.height) && bitmap.width <= MAX_TEXTURE_DIMENSION && bitmap.height <= MAX_TEXTURE_DIMENSION) {
      return { preview: await readImagePreview(file), message: `Preview ready at ${bitmap.width} × ${bitmap.height}. Confirm to import this image into the active UEFN project.` };
    }
    const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
    const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
    const drawHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG preview conversion is unavailable.');
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, Math.floor((width - drawWidth) / 2), Math.floor((height - drawHeight) / 2), drawWidth, drawHeight);
    return {
      preview: canvas.toDataURL('image/png'),
      message: `Automatically fitted ${bitmap.width} × ${bitmap.height} onto a ${width} × ${height} power-of-two canvas. Confirm to import it into UEFN.`,
    };
  } finally {
    bitmap.close();
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

export const ImageUploadZone = forwardRef<ImageUploadZoneHandle, ImageUploadZoneProps>(({
  contentFolderPath,
  assetFolderName,
  assetName,
  currentTextureRef,
  currentImageData,
  onTextureRefChange,
  onImageDataChange,
  onPendingStateChange,
}, ref) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const activeImportRef = useRef<Promise<ConfirmedTextureImport | null> | null>(null);

  const folderName = assetFolderName || 'EntitlementIcons';
  const cleanName = (assetName || 'item_icon').replace(/[^a-zA-Z0-9_]/g, '_');
  const defaultVerseRef = `${folderName}.${cleanName}`;
  const displayImage = pendingPreview || currentImageData;

  const handleFile = async (file: File) => {
    if (file.type !== 'image/png' || !file.name.toLowerCase().endsWith('.png')) {
      setUploadStatus({ success: false, message: 'Only PNG files can be imported as UEFN textures.' });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadStatus({ success: false, message: 'PNG must be 5 MB or smaller.' });
      return;
    }

    try {
      setPendingFile(file);
      const { preview, message } = await createPowerOfTwoPreview(file);
      setPendingPreview(preview);
      onPendingStateChange(true);
      setUploadStatus({ message });
    } catch (error) {
      setPendingFile(null);
      setPendingPreview(null);
      onPendingStateChange(false);
      setUploadStatus({ success: false, message: error instanceof Error ? error.message : 'PNG preview could not be read.' });
    }
  };

  const confirmImport = async (): Promise<ConfirmedTextureImport | null> => {
    if (activeImportRef.current) return activeImportRef.current;
    if (!pendingFile || !pendingPreview) return null;
    if (!contentFolderPath) {
      setUploadStatus({ success: false, message: 'The linked project is unavailable. Use Switch active project and select the project again.' });
      return null;
    }

    const operation = (async (): Promise<ConfirmedTextureImport | null> => {
      setIsUploading(true);
      setUploadStatus({ message: 'Sending the confirmed image to the UEFN editor...' });
      try {
        let job = await FileService.importTexture(folderName, cleanName, pendingFile);
        if (!job.success || !job.jobId) {
          setUploadStatus({ success: false, message: job.error || 'The image could not be queued for UEFN import.' });
          return null;
        }
        const jobId = job.jobId;

        setUploadStatus({ message: 'Waiting for UEFN to import and save the texture in the Content Browser...' });
        for (let attempt = 0; attempt < 240; attempt += 1) {
          if (job.status === 'completed') break;
          if (job.status === 'failed') break;
          await wait(500);
          job = await FileService.getTextureImport(jobId);
          if (!job.success && job.status !== 'failed') break;
        }

        if (job.status !== 'completed') {
          setUploadStatus({ success: false, message: job.error || 'UEFN did not confirm the texture import within two minutes.' });
          return null;
        }

        const confirmed: ConfirmedTextureImport = {
          preview: pendingPreview,
          fileName: pendingFile.name,
          verseAssetPath: job.verseAssetPath || defaultVerseRef,
          assetObjectPath: job.assetObjectPath,
        };
        onImageDataChange(confirmed.preview, confirmed.fileName);
        onTextureRefChange(confirmed.verseAssetPath);
        setPendingFile(null);
        setPendingPreview(null);
        onPendingStateChange(false);
        setUploadStatus({
          success: true,
          message: `Imported ${job.assetObjectPath || `${folderName}/${cleanName}`} into the active UEFN Content Browser.`,
        });
        return confirmed;
      } catch (error) {
        setUploadStatus({ success: false, message: error instanceof Error ? error.message : 'UEFN texture import failed.' });
        return null;
      } finally {
        setIsUploading(false);
      }
    })();
    activeImportRef.current = operation;
    try {
      return await operation;
    } finally {
      activeImportRef.current = null;
    }
  };

  useImperativeHandle(ref, () => ({ confirmPendingImport: confirmImport }));

  const cancelPending = (event: React.MouseEvent) => {
    event.stopPropagation();
    setPendingFile(null);
    setPendingPreview(null);
    onPendingStateChange(false);
    setUploadStatus(null);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files?.[0]) void handleFile(event.dataTransfer.files[0]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
          <span>Icon texture</span>
        </label>
        <span className="text-[11px] text-slate-400">
          UEFN destination: <code className="text-cyan-300 bg-slate-800 px-1 py-0.5 rounded font-mono">Content/{folderName}/</code>
        </span>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a PNG entitlement icon"
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInputRef.current?.click(); } }}
        className={`relative border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
          isDragging ? 'border-cyan-400 bg-cyan-500/10' : displayImage ? 'border-cyan-500/40 bg-slate-900/60 hover:border-cyan-400/70' : 'border-slate-700 hover:border-slate-600 bg-slate-900/30'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(event) => { if (event.target.files?.[0]) void handleFile(event.target.files[0]); event.target.value = ''; }}
          accept="image/png,.png"
          className="hidden"
        />

        {displayImage ? (
          <div className="w-full">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 shadow-md">
                <img src={displayImage} alt="Texture preview" className="w-full h-full object-contain" />
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white truncate">{pendingFile ? 'New image selected' : 'Texture imported'}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${pendingFile ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'}`}>
                    {pendingFile ? 'Awaiting confirmation' : 'In Content Browser'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">Ref: <span className="text-cyan-300 font-semibold">{currentTextureRef || defaultVerseRef}</span></p>
                <p className="text-[11px] text-slate-500 mt-1">Click or drag a new PNG to replace</p>
              </div>
            </div>

            {pendingFile && (
              <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-800" onClick={event => event.stopPropagation()}>
                <button type="button" onClick={cancelPending} disabled={isUploading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
                <button type="button" onClick={() => void confirmImport()} disabled={isUploading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-400 text-slate-950 text-xs font-extrabold hover:bg-cyan-300 disabled:opacity-40">
                  {isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {isUploading ? 'Importing...' : 'Confirm & import into UEFN'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="py-2">
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-2 text-slate-400"><Upload className="w-5 h-5" /></div>
            <p className="text-xs font-semibold text-slate-200">Drop PNG image here or <span className="text-cyan-400 underline">browse</span></p>
            <p className="text-[11px] text-slate-400 mt-1">Images are automatically fitted to a transparent power-of-two canvas for UEFN.</p>
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 bg-[#0b0f19]/80 backdrop-blur-sm rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-cyan-300">
            <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
            <span>UEFN is importing and saving the texture...</span>
          </div>
        )}
      </div>

      {uploadStatus && (
        <div className={`text-xs py-1.5 px-3 rounded-lg flex items-center gap-2 ${uploadStatus.success ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : uploadStatus.success === false ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300' : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-300'}`}>
          {uploadStatus.success ? <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" /> : uploadStatus.success === false ? <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0 text-cyan-400" />}
          <span>{uploadStatus.message}</span>
        </div>
      )}

      <div>
        <label className="text-[11px] font-medium text-slate-400 flex items-center justify-between mb-1">
          <span>Verse Texture Expression</span>
          <button type="button" onClick={() => onTextureRefChange(defaultVerseRef)} className="text-[10px] text-cyan-400 hover:underline">Reset to default ({defaultVerseRef})</button>
        </label>
        <div className="relative">
          <input type="text" value={currentTextureRef} onChange={(event) => onTextureRefChange(event.target.value)} placeholder={defaultVerseRef} className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400 transition-colors" />
          <Layers className="w-4 h-4 text-slate-500 absolute right-3 top-2.5 pointer-events-none" />
        </div>
      </div>
    </div>
  );
});

ImageUploadZone.displayName = 'ImageUploadZone';
