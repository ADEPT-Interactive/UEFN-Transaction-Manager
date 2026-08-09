import React, { useState, useRef } from 'react';
import { Upload, Image as ImageIcon, CheckCircle, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { FileService } from '../services/fileService';

interface ImageUploadZoneProps {
  contentFolderPath: string;
  assetFolderName: string;
  assetName: string;
  currentTextureRef: string;
  currentImageData?: string;
  onTextureRefChange: (ref: string) => void;
  onImageDataChange: (base64: string, fileName?: string) => void;
}

export const ImageUploadZone: React.FC<ImageUploadZoneProps> = ({
  contentFolderPath,
  assetFolderName,
  assetName,
  currentTextureRef,
  currentImageData,
  onTextureRefChange,
  onImageDataChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success?: boolean; message?: string } | null>(null);

  const cleanName = (assetName || 'item_icon').replace(/[^a-zA-Z0-9_]/g, '_');
  const defaultVerseRef = `${assetFolderName || 'EntitlementIcons'}.${cleanName}`;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadStatus({ success: false, message: 'Please upload a valid PNG or image file.' });
      return;
    }

    // 1. Read Base64 for instant UI preview
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      onImageDataChange(base64, file.name);

      // Auto-set the suggested Verse path if empty or default
      if (!currentTextureRef || currentTextureRef.startsWith('EntitlementIcons.')) {
        onTextureRefChange(defaultVerseRef);
      }

      // 2. If content folder path is set, upload directly to the project's public image directory
      if (contentFolderPath) {
        setIsUploading(true);
        setUploadStatus(null);
        try {
          const result = await FileService.uploadTexture(
            contentFolderPath,
            assetFolderName || 'EntitlementIcons',
            cleanName,
            file
          );
          if (result.success) {
            onTextureRefChange(result.verseAssetPath || defaultVerseRef);
            setUploadStatus({
              success: true,
              message: `Uploaded to Content/${assetFolderName}/${cleanName}.png & mapped to ${result.verseAssetPath}!`,
            });
          } else {
            setUploadStatus({
              success: false,
              message: result.error || 'Failed to save image to project folder.',
            });
          }
        } catch (err: any) {
          setUploadStatus({ success: false, message: err?.message || 'Upload error' });
        } finally {
          setIsUploading(false);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
          <span>Icon Texture Asset (PNG / .uasset)</span>
        </label>
        <span className="text-[11px] text-slate-400">
          Folder: <code className="text-cyan-300 bg-slate-800 px-1 py-0.5 rounded font-mono">Content/{assetFolderName}/</code>
        </span>
      </div>

      {/* Drag & Drop Card */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-cyan-400 bg-cyan-500/10'
            : currentImageData
            ? 'border-cyan-500/40 bg-slate-900/60 hover:border-cyan-400/70'
            : 'border-slate-700 hover:border-slate-600 bg-slate-900/30'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          accept="image/png, image/jpeg, image/webp"
          className="hidden"
        />

        {currentImageData ? (
          <div className="flex items-center gap-4 w-full">
            <div className="w-16 h-16 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 shadow-md">
              <img src={currentImageData} alt="Preview" className="w-full h-full object-contain" />
            </div>
            <div className="text-left flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white truncate">Image Attached</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">Ready</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
                Ref: <span className="text-cyan-300 font-semibold">{currentTextureRef || defaultVerseRef}</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">Click or drag a new PNG to replace</p>
            </div>
          </div>
        ) : (
          <div className="py-2">
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-2 text-slate-400 group-hover:text-cyan-400 transition-colors">
              <Upload className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-slate-200">
              Drop PNG image here or <span className="text-cyan-400 underline">browse</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Automatically saved to <code className="text-cyan-300 font-mono">Content/{assetFolderName}/</code> and converted to UEFN texture reference
            </p>
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 bg-[#0b0f19]/80 backdrop-blur-sm rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-cyan-300">
            <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
            <span>Importing to UEFN Content directory...</span>
          </div>
        )}
      </div>

      {/* Upload Feedback Status */}
      {uploadStatus && (
        <div
          className={`text-xs py-1.5 px-3 rounded-lg flex items-center gap-2 ${
            uploadStatus.success
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          {uploadStatus.success ? (
            <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
          )}
          <span>{uploadStatus.message}</span>
        </div>
      )}

      {/* Manual Verse Texture Path Reference Input */}
      <div>
        <label className="text-[11px] font-medium text-slate-400 flex items-center justify-between mb-1">
          <span>Verse Texture Expression</span>
          <button
            type="button"
            onClick={() => onTextureRefChange(defaultVerseRef)}
            className="text-[10px] text-cyan-400 hover:underline"
          >
            Reset to default ({defaultVerseRef})
          </button>
        </label>
        <div className="relative">
          <input
            type="text"
            value={currentTextureRef}
            onChange={(e) => onTextureRefChange(e.target.value)}
            placeholder={defaultVerseRef}
            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400 transition-colors"
          />
          <Layers className="w-4 h-4 text-slate-500 absolute right-3 top-2.5 pointer-events-none" />
        </div>
      </div>
    </div>
  );
};
