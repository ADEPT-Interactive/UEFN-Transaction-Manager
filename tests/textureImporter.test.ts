import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { claimNextTextureImport, cleanupTextureImportJobs, finishTextureImport, getTextureImportJob, normalizeImageToPowerOfTwo, normalizePngToPowerOfTwo, queueTextureAdoption, queueTextureImport, resetTextureImportJob } from '../server/textureImporter';
import { listProjectIconPreviews, resolveProjectIconPreview } from '../server/iconPreviews';
import { calculatePowerOfTwoTextureLayout } from '../src/services/textureDimensions';

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 24, g: 180, b: 220, alpha: 1 } } }).png().toBuffer();
}

test('power-of-two images bypass normalization byte-for-byte', async () => {
  const original = await png(256, 512);
  assert.strictEqual(await normalizePngToPowerOfTwo(original), original);
  assert.deepEqual(calculatePowerOfTwoTextureLayout(256, 512), {
    sourceWidth: 256,
    sourceHeight: 512,
    targetWidth: 256,
    targetHeight: 512,
    drawWidth: 256,
    drawHeight: 512,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    normalized: false,
    paddingRequired: false,
  });
  const largePowerOfTwo = calculatePowerOfTwoTextureLayout(8192, 4096);
  assert.equal(largePowerOfTwo.normalized, false);
  assert.deepEqual([largePowerOfTwo.targetWidth, largePowerOfTwo.targetHeight], [8192, 4096]);
});

test('accepted non-PNG images are converted to canonical PNG', async () => {
  const jpeg = await sharp({ create: { width: 300, height: 500, channels: 3, background: { r: 24, g: 180, b: 220 } } }).jpeg().toBuffer();
  const normalized = await normalizeImageToPowerOfTwo(jpeg);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, 'png');
  assert.deepEqual([metadata.width, metadata.height], [256, 512]);
});

test('non-power-of-two images use the closest shape and preserve their aspect ratio', async () => {
  assert.deepEqual(
    [
      calculatePowerOfTwoTextureLayout(300, 300),
      calculatePowerOfTwoTextureLayout(300, 600),
      calculatePowerOfTwoTextureLayout(300, 500),
      calculatePowerOfTwoTextureLayout(500, 300),
    ].map(layout => [layout.targetWidth, layout.targetHeight, layout.paddingRequired]),
    [[256, 256, false], [256, 512, false], [256, 512, true], [512, 256, true]],
  );

  const normalized = await normalizePngToPowerOfTwo(await png(300, 500));
  const { data, info } = await sharp(normalized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 256);
  assert.equal(info.height, 512);
  const opaquePixels: Array<[number, number]> = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] > 0) opaquePixels.push([x, y]);
    }
  }
  assert.deepEqual([
    Math.min(...opaquePixels.map(([x]) => x)),
    Math.max(...opaquePixels.map(([x]) => x)),
    Math.min(...opaquePixels.map(([, y]) => y)),
    Math.max(...opaquePixels.map(([, y]) => y)),
  ], [0, 255, 42, 468]);
});

test('texture imports are normalized before UEFN receives them', async () => {
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
  assert.equal(stagedMetadata.width, 256);
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

test('existing Texture2D adoption is a validated editor job and never accepts filesystem paths', () => {
  assert.throws(() => queueTextureAdoption('EntitlementIcons', 'VipPass', 'C:\\Project\\Vip.uasset'), /project asset object path/);
  const queued = queueTextureAdoption('EntitlementIcons', 'VipPass', '/ProjectMount/OldShopIcons/Vip.Vip');
  assert.equal(queued.status, 'queued');
  assert.equal(queued.sourceKind, 'uefn-texture');
  assert.equal(queued.sourceAssetPath, '/ProjectMount/OldShopIcons/Vip.Vip');
  let claimed = claimNextTextureImport();
  while (claimed && claimed.jobId !== queued.jobId) {
    finishTextureImport(claimed.jobId, { success: false, error: 'test cleanup' });
    claimed = claimNextTextureImport();
  }
  assert.equal(claimed?.sourceKind, 'uefn-texture');
  assert.equal(claimed?.sourceAssetPath, '/ProjectMount/OldShopIcons/Vip.Vip');
  finishTextureImport(queued.jobId, { success: false, error: 'test cleanup' });
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
