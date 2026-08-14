export const MAX_TEXTURE_DIMENSION = 4096;

export interface PowerOfTwoTextureLayout {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  normalized: boolean;
  paddingRequired: boolean;
}

export function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function powerOfTwoSizes(maximum: number): number[] {
  const sizes: number[] = [];
  for (let size = 1; size <= maximum; size *= 2) sizes.push(size);
  return sizes;
}

/**
 * Finds the power-of-two rectangle that preserves the source aspect ratio with
 * the least transparent area, then prefers the uniform scale closest to 1:1.
 */
export function calculatePowerOfTwoTextureLayout(
  sourceWidth: number,
  sourceHeight: number,
  maximumDimension = MAX_TEXTURE_DIMENSION,
): PowerOfTwoTextureLayout {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Texture dimensions must be positive integers.');
  }
  if (!isPowerOfTwo(maximumDimension)) throw new Error('Maximum texture dimension must be a power of two.');

  if (isPowerOfTwo(sourceWidth) && isPowerOfTwo(sourceHeight)) {
    return {
      sourceWidth,
      sourceHeight,
      targetWidth: sourceWidth,
      targetHeight: sourceHeight,
      drawWidth: sourceWidth,
      drawHeight: sourceHeight,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      normalized: false,
      paddingRequired: false,
    };
  }

  const candidates = powerOfTwoSizes(maximumDimension);
  let best: { width: number; height: number; scale: number; emptyFraction: number; scaleDistance: number; area: number } | undefined;
  const epsilon = 1e-12;

  for (const width of candidates) {
    for (const height of candidates) {
      const scale = Math.min(width / sourceWidth, height / sourceHeight);
      const occupiedArea = sourceWidth * scale * sourceHeight * scale;
      const emptyFraction = 1 - occupiedArea / (width * height);
      const scaleDistance = Math.abs(Math.log2(scale));
      const area = width * height;
      const isBetter = !best
        || emptyFraction < best.emptyFraction - epsilon
        || (Math.abs(emptyFraction - best.emptyFraction) <= epsilon && scaleDistance < best.scaleDistance - epsilon)
        || (Math.abs(emptyFraction - best.emptyFraction) <= epsilon && Math.abs(scaleDistance - best.scaleDistance) <= epsilon && area < best.area);
      if (isBetter) best = { width, height, scale, emptyFraction, scaleDistance, area };
    }
  }

  if (!best) throw new Error('No supported power-of-two texture size is available.');
  const drawWidth = Math.min(best.width, Math.max(1, Math.round(sourceWidth * best.scale)));
  const drawHeight = Math.min(best.height, Math.max(1, Math.round(sourceHeight * best.scale)));
  const offsetX = Math.floor((best.width - drawWidth) / 2);
  const offsetY = Math.floor((best.height - drawHeight) / 2);
  return {
    sourceWidth,
    sourceHeight,
    targetWidth: best.width,
    targetHeight: best.height,
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
    scale: best.scale,
    normalized: true,
    paddingRequired: drawWidth !== best.width || drawHeight !== best.height,
  };
}
