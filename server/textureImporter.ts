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
  destinationPath?: string;
  assetObjectPath?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  claimedAt?: number;
}

export interface TextureImportJobResponse {
  success: boolean;
  jobId: string;
  status: TextureImportJobStatus;
  assetFolderName: string;
  assetName: string;
  verseAssetPath: string;
  destinationPath?: string;
  assetObjectPath?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TextureImportJobResult {
  success: boolean;
  destinationPath?: string;
  assetObjectPath?: string;
  error?: string;
}

const jobs = new Map<string, TextureImportJob>();
const stagingRoot = path.join(os.tmpdir(), 'UEFN Entitlement Manager', 'texture-imports');
const JOB_TTL_MS = 15 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 120 * 1000;
const MAX_PENDING_TEXTURE_JOBS = 32;
export async function normalizePngToPowerOfTwo(pngBuffer: Buffer): Promise<Buffer> {
  const image = sharp(pngBuffer, { failOn: 'error' });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.format !== 'png') {
    throw new Error('Uploaded image is not a readable PNG.');
  }
  const layout = calculatePowerOfTwoTextureLayout(metadata.width, metadata.height);
  if (!layout.normalized) return pngBuffer;
  return image
    .resize(layout.targetWidth, layout.targetHeight, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

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
  const normalizedPng = await normalizePngToPowerOfTwo(pngBuffer);
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
