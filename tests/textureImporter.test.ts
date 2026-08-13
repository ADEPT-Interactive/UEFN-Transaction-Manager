import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { claimNextTextureImport, cleanupTextureImportJobs, finishTextureImport, getTextureImportJob, queueTextureImport, resetTextureImportJob } from '../server/textureImporter';
import { listProjectIconPreviews, resolveProjectIconPreview } from '../server/iconPreviews';

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 24, g: 180, b: 220, alpha: 1 } } }).png().toBuffer();
}

test('texture imports are normalized to power-of-two canvases before UEFN receives them', async () => {
  const contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-icon-preview-'));
  const queued = await queueTextureImport('EntitlementIcons', 'VipPass', await png(300, 500));
  assert.equal(queued.success, true);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.verseAssetPath, 'EntitlementIcons.VipPass');
  assert.equal('sourcePath' in queued, false);

  const claimed = claimNextTextureImport();
  assert.equal(claimed?.jobId, queued.jobId);
  assert.equal(claimed?.status, 'processing');
  assert.equal(claimed?.sourcePath.endsWith('.png'), true);
  const stagedPng = fs.readFileSync(claimed!.sourcePath);
  const stagedMetadata = await sharp(stagedPng).metadata();
  assert.equal(stagedMetadata.width, 512);
  assert.equal(stagedMetadata.height, 512);

  try {
    const completed = finishTextureImport(queued.jobId, {
      success: true,
      destinationPath: '/MyProject/EntitlementIcons',
      assetObjectPath: '/MyProject/EntitlementIcons/VipPass.VipPass',
    }, contentRoot);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.assetObjectPath, '/MyProject/EntitlementIcons/VipPass.VipPass');
    assert.equal(getTextureImportJob(queued.jobId).status, 'completed');
    assert.deepEqual(listProjectIconPreviews(contentRoot, 'EntitlementIcons'), [{
      assetFolderName: 'EntitlementIcons',
      assetName: 'VipPass',
      verseAssetPath: 'EntitlementIcons.VipPass',
      assetObjectPath: '/MyProject/EntitlementIcons/VipPass.VipPass',
    }]);
    assert.deepEqual(fs.readFileSync(resolveProjectIconPreview(contentRoot, 'EntitlementIcons', 'VipPass')), stagedPng);
  } finally {
    fs.rmSync(contentRoot, { recursive: true, force: true });
  }
});

test('failed texture imports can be retried without exposing the source to the browser', async () => {
  const queued = await queueTextureImport('EntitlementIcons', 'RetryMe', await png(8, 8));
  claimNextTextureImport();
  const failed = finishTextureImport(queued.jobId, { success: false, error: 'UEFN import failed.' });
  assert.equal(failed.success, false);
  assert.equal(failed.status, 'failed');
  assert.equal('sourcePath' in failed, false);
  assert.equal(resetTextureImportJob(queued.jobId).status, 'queued');
});

test('stale texture jobs expire and release their staged source', async () => {
  const queued = await queueTextureImport('EntitlementIcons', 'Expires', await png(16, 16));
  cleanupTextureImportJobs(Date.now() + 16 * 60 * 1000);
  assert.throws(() => getTextureImportJob(queued.jobId), /expired/);
});

test('legacy PNG sources in the project icon folder remain discoverable', () => {
  const contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-legacy-icon-'));
  try {
    const iconDirectory = path.join(contentRoot, 'EntitlementIcons');
    fs.mkdirSync(iconDirectory);
    fs.writeFileSync(path.join(iconDirectory, 'Legacy.png'), Buffer.from('legacy-preview'));
    assert.deepEqual(listProjectIconPreviews(contentRoot, 'EntitlementIcons'), [{
      assetFolderName: 'EntitlementIcons', assetName: 'Legacy', verseAssetPath: 'EntitlementIcons.Legacy',
    }]);
    assert.equal(fs.readFileSync(resolveProjectIconPreview(contentRoot, 'EntitlementIcons', 'Legacy')).toString(), 'legacy-preview');
  } finally {
    fs.rmSync(contentRoot, { recursive: true, force: true });
  }
});
