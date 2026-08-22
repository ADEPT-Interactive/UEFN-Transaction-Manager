import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { persistProjectIconPreview } from './iconPreviews';
import { calculatePowerOfTwoTextureLayout } from '../src/services/textureDimensions';

export type TextureImportJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface TextureImportJob {
  jobId: string;
  status: TextureImportJobStatus;
  assetFolderName: string;
  assetName: string;
  verseAssetPath: string;
  sourcePath: string;
  sourceKind?: 'local-image' | 'uefn-texture';
  sourceAssetPath?: string;
  destinationPath?: string;
  assetObjectPath?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  claimedAt?: number;
  finalWidth?: number;
  finalHeight?: number;
}

export interface TextureImportJobResponse {
  success: boolean;
  jobId: string;
  status: TextureImportJobStatus;
  assetFolderName: string;
  assetName: string;
  verseAssetPath: string;
  sourceKind?: 'local-image' | 'uefn-texture';
  sourceAssetPath?: string;
  destinationPath?: string;
  assetObjectPath?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  finalWidth?: number;
  finalHeight?: number;
}

export interface TextureImportJobResult {
  success: boolean;
  destinationPath?: string;
  assetObjectPath?: string;
  error?: string;
  finalWidth?: number;
  finalHeight?: number;
}

const jobs = new Map<string, TextureImportJob>();
const stagingRoot = path.join(os.tmpdir(), 'UEFN Entitlement Manager', 'texture-imports');
const JOB_TTL_MS = 15 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 120 * 1000;
const MAX_PENDING_TEXTURE_JOBS = 32;

function decodeRadianceHdr(buffer: Buffer): { data: Buffer; width: number; height: number } {
  const headerEnd = buffer.indexOf(Buffer.from('\n\n'));
  if (headerEnd < 0) throw new Error('The exported HDR texture has no valid Radiance header.');
  const resolutionLineEnd = buffer.indexOf(0x0a, headerEnd + 2);
  const resolutionLine = buffer.subarray(headerEnd + 2, resolutionLineEnd < 0 ? buffer.length : resolutionLineEnd).toString('ascii').trim();
  const resolutionMatch = /^-Y (\d+) \+X (\d+)$/.exec(resolutionLine);
  if (!resolutionMatch) throw new Error('The exported HDR texture has no supported -Y/+X resolution.');
  const height = Number(resolutionMatch[1]);
  const width = Number(resolutionMatch[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32767) {
    throw new Error('The exported HDR texture has an invalid resolution.');
  }

  let offset = resolutionLineEnd < 0 ? buffer.length : resolutionLineEnd + 1;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    if (offset + 4 > buffer.length) throw new Error('The exported HDR texture ended before a complete scanline.');
    const isRle = buffer[offset] === 2 && buffer[offset + 1] === 2 && buffer[offset + 2] === (width >> 8) && buffer[offset + 3] === (width & 255);
    offset += 4;
    if (!isRle) {
      offset -= 4;
      for (let x = 0; x < width; x += 1) {
        if (offset + 4 > buffer.length) throw new Error('The exported HDR texture ended inside a pixel.');
        const red = buffer[offset++];
        const green = buffer[offset++];
        const blue = buffer[offset++];
        const exponent = buffer[offset++];
        const scale = exponent === 0 ? 0 : 255 * 2 ** (exponent - 128) / 256;
        const pixelOffset = (y * width + x) * 3;
        pixels[pixelOffset] = Math.min(255, Math.round(red * scale));
        pixels[pixelOffset + 1] = Math.min(255, Math.round(green * scale));
        pixels[pixelOffset + 2] = Math.min(255, Math.round(blue * scale));
      }
      continue;
    }
    const channels: Buffer[] = [];
    for (let channel = 0; channel < 4; channel += 1) {
      const values = Buffer.alloc(width);
      let position = 0;
      while (position < width) {
        if (offset >= buffer.length) throw new Error('The exported HDR texture ended inside a scanline.');
        const count = buffer[offset++];
        if (isRle && count > 128) {
          const runLength = count - 128;
          if (runLength < 1 || position + runLength > width || offset >= buffer.length) throw new Error('The exported HDR texture contains an invalid RLE run.');
          values.fill(buffer[offset++], position, position + runLength);
          position += runLength;
        } else {
          const literalLength = isRle ? count : Math.min(count, width - position);
          if (literalLength < 1 || position + literalLength > width || offset + literalLength > buffer.length) throw new Error('The exported HDR texture contains an invalid literal run.');
          buffer.copy(values, position, offset, offset + literalLength);
          offset += literalLength;
          position += literalLength;
        }
      }
      channels.push(values);
    }
    for (let x = 0; x < width; x += 1) {
      const exponent = channels[3][x];
      const scale = exponent === 0 ? 0 : 255 * 2 ** (exponent - 128) / 256;
      const pixelOffset = (y * width + x) * 3;
      pixels[pixelOffset] = Math.min(255, Math.round(channels[0][x] * scale));
      pixels[pixelOffset + 1] = Math.min(255, Math.round(channels[1][x] * scale));
      pixels[pixelOffset + 2] = Math.min(255, Math.round(channels[2][x] * scale));
    }
  }
  return { data: pixels, width, height };
}

export async function normalizeImageToPowerOfTwo(imageBuffer: Buffer): Promise<Buffer> {
  if (imageBuffer.subarray(0, 10).toString('ascii') === '#?RADIANCE') {
    const decoded = decodeRadianceHdr(imageBuffer);
    const layout = calculatePowerOfTwoTextureLayout(decoded.width, decoded.height);
    const image = sharp(decoded.data, { raw: { width: decoded.width, height: decoded.height, channels: 3 } });
    return (layout.normalized
      ? image.resize(layout.targetWidth, layout.targetHeight, { fit: 'contain', position: 'centre', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      : image).png().toBuffer();
  }
  const image = sharp(imageBuffer, { failOn: 'error', limitInputPixels: 8192 * 8192 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || !metadata.format || !['png', 'jpeg', 'webp', 'gif', 'avif', 'tiff', 'hdr'].includes(metadata.format)) {
    throw new Error('The selected image is not a supported readable image.');
  }
  const layout = calculatePowerOfTwoTextureLayout(metadata.width, metadata.height);
  if (!layout.normalized && metadata.format === 'png') return imageBuffer;
  if (!layout.normalized) return image.png().toBuffer();
  return image
    .resize(layout.targetWidth, layout.targetHeight, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** Compatibility name retained for the existing manual PNG workflow. */
export const normalizePngToPowerOfTwo = normalizeImageToPowerOfTwo;

function removeSource(job: TextureImportJob): void {
  if (fs.existsSync(job.sourcePath)) fs.unlinkSync(job.sourcePath);
}

export function cleanupTextureImportJobs(now = Date.now()): void {
  for (const [jobId, job] of jobs) {
    if (job.status === 'processing' && job.claimedAt && now - job.claimedAt > CLAIM_TIMEOUT_MS) {
      job.status = 'queued';
      job.claimedAt = undefined;
    }
    const createdAt = Date.parse(job.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt <= JOB_TTL_MS) continue;
    if (job.status === 'processing') continue;
    removeSource(job);
    jobs.delete(jobId);
  }
}

function publicJob(job: TextureImportJob): TextureImportJobResponse {
  const { sourcePath: _sourcePath, claimedAt: _claimedAt, ...response } = job;
  return { success: response.status !== 'failed', ...response };
}

function getJobOrThrow(jobId: string): TextureImportJob {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Texture import job was not found or has expired.');
  return job;
}

export async function queueTextureImport(assetFolderName: string, assetName: string, pngBuffer: Buffer): Promise<TextureImportJobResponse> {
  cleanupTextureImportJobs();
  const pending = [...jobs.values()].filter(job => job.status === 'queued' || job.status === 'processing').length;
  if (pending >= MAX_PENDING_TEXTURE_JOBS) throw new Error(`Too many texture imports are pending. Finish or retry existing jobs before adding another (limit ${MAX_PENDING_TEXTURE_JOBS}).`);
  const normalizedPng = await normalizeImageToPowerOfTwo(pngBuffer);
  fs.mkdirSync(stagingRoot, { recursive: true });
  const jobId = crypto.randomUUID();
  const temporaryPath = path.join(stagingRoot, `.${jobId}.tmp`);
  const sourcePath = path.join(stagingRoot, `${jobId}.png`);
  fs.writeFileSync(temporaryPath, normalizedPng, { flag: 'wx' });
  fs.renameSync(temporaryPath, sourcePath);

  const job: TextureImportJob = {
    jobId,
    status: 'queued',
    assetFolderName,
    assetName,
    verseAssetPath: `${assetFolderName}.${assetName}`,
    sourcePath,
    sourceKind: 'local-image',
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  return publicJob(job);
}

export function queueTextureAdoption(assetFolderName: string, assetName: string, sourceAssetPath: string): TextureImportJobResponse {
  cleanupTextureImportJobs();
  if (!/^\/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*\.[A-Za-z_][A-Za-z0-9_]*$/.test(sourceAssetPath)) {
    throw new Error('The existing Texture2D path must be a project asset object path such as /ProjectMount/OldShopIcons/Vip.Vip.');
  }
  const pending = [...jobs.values()].filter(job => job.status === 'queued' || job.status === 'processing').length;
  if (pending >= MAX_PENDING_TEXTURE_JOBS) throw new Error(`Too many texture imports are pending. Finish or retry existing jobs before adding another (limit ${MAX_PENDING_TEXTURE_JOBS}).`);
  fs.mkdirSync(stagingRoot, { recursive: true });
  const jobId = crypto.randomUUID();
  const job: TextureImportJob = {
    jobId,
    status: 'queued',
    assetFolderName,
    assetName,
    verseAssetPath: `${assetFolderName}.${assetName}`,
    sourcePath: path.join(stagingRoot, `${jobId}.png`),
    sourceKind: 'uefn-texture',
    sourceAssetPath,
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  return publicJob(job);
}

export function claimNextTextureImport(): (TextureImportJob & { success: true }) | null {
  cleanupTextureImportJobs();
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.status !== 'queued') continue;
    job.status = 'processing';
    job.claimedAt = now;
    return { ...job, success: true };
  }
  return null;
}

export function getTextureImportJob(jobId: string): TextureImportJobResponse {
  cleanupTextureImportJobs();
  return publicJob(getJobOrThrow(jobId));
}

export async function normalizeTextureImportJob(jobId: string): Promise<TextureImportJobResponse> {
  const job = getJobOrThrow(jobId);
  if (job.status !== 'processing') throw new Error('Only a claimed texture import can be normalized.');
  const normalized = await normalizeImageToPowerOfTwo(fs.readFileSync(job.sourcePath));
  const temporaryPath = `${job.sourcePath}.normalized`;
  fs.writeFileSync(temporaryPath, normalized, { flag: 'wx' });
  fs.renameSync(temporaryPath, job.sourcePath);
  return publicJob(job);
}

export function finishTextureImport(jobId: string, result: TextureImportJobResult, contentRoot?: string): TextureImportJobResponse {
  const job = getJobOrThrow(jobId);
  if (job.status !== 'processing') throw new Error('Only a claimed texture import can be completed.');
  let finalResult = result;
  if (result.success && contentRoot) {
    try {
      persistProjectIconPreview(contentRoot, job.assetFolderName, job.assetName, fs.readFileSync(job.sourcePath), result.assetObjectPath);
    } catch (error) {
      finalResult = { success: false, error: error instanceof Error ? `Project icon preview could not be persisted: ${error.message}` : 'Project icon preview could not be persisted.' };
    }
  }
  job.status = finalResult.success ? 'completed' : 'failed';
  job.destinationPath = finalResult.destinationPath;
  job.assetObjectPath = finalResult.assetObjectPath;
  job.finalWidth = finalResult.finalWidth;
  job.finalHeight = finalResult.finalHeight;
  job.error = finalResult.error;
  job.completedAt = new Date().toISOString();
  job.claimedAt = undefined;
  if (finalResult.success) {
    removeSource(job);
  }
  return publicJob(job);
}

export function resetTextureImportJob(jobId: string): TextureImportJobResponse {
  const job = getJobOrThrow(jobId);
  if (job.status !== 'failed') throw new Error('Only failed texture imports can be retried.');
  job.status = 'queued';
  job.error = undefined;
  job.destinationPath = undefined;
  job.assetObjectPath = undefined;
  job.completedAt = undefined;
  return publicJob(job);
}
