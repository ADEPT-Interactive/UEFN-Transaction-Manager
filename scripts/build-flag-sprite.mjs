import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(toolRoot, 'node_modules', 'flag-icons', 'flags', '4x3');
const outputPath = path.join(toolRoot, 'public', 'flag-sprite.webp');
if (!fs.existsSync(sourceRoot)) throw new Error('flag-icons is not installed. Run npm install before building.');
const countrySource = fs.readFileSync(path.join(toolRoot, 'src', 'constants', 'offerRestrictions.ts'), 'utf8');
const countryCodes = (countrySource.match(/const FLAG_COUNTRY_CODES = `([\s\S]*?)`/)?.[1] ?? '').trim().split(/\s+/).sort();
if (countryCodes.length < 240) throw new Error('The ISO country-code list could not be read.');

const columns = 16;
const flagWidth = 48;
const flagHeight = 36;
// Keep a two-physical-pixel transparent gutter around every source tile. This
// maps to one CSS pixel at the displayed size and prevents neighbouring cells
// from being sampled at the top/left edges of a flag.
const gutter = 2;
const cellWidth = flagWidth + gutter * 2;
const cellHeight = flagHeight + gutter * 2;
const rows = Math.ceil(countryCodes.length / columns);
const flags = await Promise.all(countryCodes.map(async (code, index) => ({
  input: await sharp(path.join(sourceRoot, `${code}.svg`)).resize(flagWidth, flagHeight, { fit: 'fill' }).png().toBuffer(),
  left: (index % columns) * cellWidth + gutter,
  top: Math.floor(index / columns) * cellHeight + gutter,
})));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
await sharp({ create: { width: columns * cellWidth, height: rows * cellHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(flags)
  // Lossless encoding keeps colour blocks isolated; lossy WebP can otherwise
  // blend colours across an atlas-cell boundary before CSS samples it.
  .webp({ lossless: true, effort: 6 })
  .toFile(outputPath);
const legacySvg = path.join(toolRoot, 'public', 'flag-sprite.svg');
if (fs.existsSync(legacySvg)) fs.unlinkSync(legacySvg);
console.log(`Built ${countryCodes.length} flags into one ${fs.statSync(outputPath).size}-byte WebP sprite.`);
