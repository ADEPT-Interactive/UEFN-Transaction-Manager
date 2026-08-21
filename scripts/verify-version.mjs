import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = JSON.parse(fs.readFileSync(path.join(toolRoot, 'version.json'), 'utf8')).version;
const packageVersion = JSON.parse(fs.readFileSync(path.join(toolRoot, 'package.json'), 'utf8')).version;
const readme = fs.readFileSync(path.join(toolRoot, 'README.md'), 'utf8');
const userReadme = fs.readFileSync(path.join(toolRoot, 'README-USER.txt'), 'utf8');
const builderConfig = JSON.parse(fs.readFileSync(path.join(toolRoot, 'electron-builder.json'), 'utf8'));

const values = { canonical, packageVersion };
for (const [label, value] of Object.entries(values)) {
  if (value !== canonical) throw new Error(`${label} is ${value ?? 'missing'}; expected ${canonical}.`);
}
if (builderConfig.productName !== 'UEFN Entitlement Manager') throw new Error('electron-builder product identity is not canonical.');
if (builderConfig.executableName !== 'UEFN Entitlement Manager') throw new Error('electron-builder executable identity is not stable.');
if (builderConfig.appId !== 'AD3PTInteractive.UEFNEntitlementManager') throw new Error('electron-builder app identity is not stable.');
if (builderConfig.nsis?.artifactName !== 'UEFN-Entitlement-Manager-Setup-${version}.${ext}') throw new Error('NSIS artifact naming is not canonical.');
if (builderConfig.publish?.[0]?.provider !== 'generic') throw new Error('electron-builder updater provider is not generic.');
if (builderConfig.publish?.[0]?.url !== 'https://updates.adeptinteractive.net/uem/stable/') throw new Error('electron-builder updater URL is not the ADEPT stable endpoint.');
for (const [label, content] of Object.entries({ readme, userReadme })) {
  if (!content.includes('UEFN-Entitlement-Manager-Setup.exe')) throw new Error(`${label} does not name the stable human installer alias.`);
}
if (!readme.includes(`Version ${canonical}`) || !readme.includes(`version-${canonical}`)) throw new Error('README current version badge is not canonical.');
if (!readme.includes('https://discord.gg/playadept') || !readme.includes('790712680482603038')) throw new Error('README Discord identity is not canonical.');
if (/stable GitHub Releases updates|GitHub is the automatic updater backend/i.test(readme)) throw new Error('README still describes GitHub as the automatic updater backend.');

console.log(`Version consistency verified: ${canonical}`);
