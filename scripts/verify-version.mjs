import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = JSON.parse(fs.readFileSync(path.join(toolRoot, 'version.json'), 'utf8')).version;
const packageVersion = JSON.parse(fs.readFileSync(path.join(toolRoot, 'package.json'), 'utf8')).version;
const readme = fs.readFileSync(path.join(toolRoot, 'README.md'), 'utf8');
const userReadme = fs.readFileSync(path.join(toolRoot, 'README-USER.txt'), 'utf8');
const packager = fs.readFileSync(path.join(toolRoot, 'scripts', 'package-electron.mjs'), 'utf8');

const values = { canonical, packageVersion };
for (const [label, value] of Object.entries(values)) {
  if (value !== canonical) throw new Error(`${label} is ${value ?? 'missing'}; expected ${canonical}.`);
}
if (!packager.includes('UEFNEntitlementManager-${version}')) throw new Error('Electron packager does not derive its executable name from the canonical version.');
if (/electronVersion:\s*['\"]/.test(packager)) throw new Error('Electron packager hard-codes a runtime version instead of reading the installed locked package.');
for (const [label, content] of Object.entries({ readme, userReadme })) {
  if (!content.includes(`UEFNEntitlementManager-${canonical}.exe`)) throw new Error(`${label} does not name the canonical Electron executable.`);
}

console.log(`Version consistency verified: ${canonical}`);
