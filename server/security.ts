import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const VERSE_FILE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\.verse$/i;
export const VERSE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateVerseFileName(value: unknown): string {
  if (typeof value !== 'string' || !VERSE_FILE_PATTERN.test(value)) {
    throw new Error('Verse filename must be a basename such as managed_transactions.verse.');
  }
  return value;
}

export function validateIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !VERSE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid Verse identifier.`);
  }
  return value;
}

export function tokensEqual(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isPng(buffer: Buffer): boolean {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

export function assertExistingPathInsideRoot(root: string, target: string): string {
  const canonicalRoot = fs.realpathSync(root);
  const canonicalTarget = fs.realpathSync(target);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return canonicalTarget;
  }
  throw new Error('Resolved path leaves the authorized Content directory.');
}
