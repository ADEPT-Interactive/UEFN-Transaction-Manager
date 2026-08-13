import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = JSON.parse(fs.readFileSync(path.join(toolRoot, 'version.json'), 'utf8')).version;
const packageVersion = JSON.parse(fs.readFileSync(path.join(toolRoot, 'package.json'), 'utf8')).version;
const manifest = fs.readFileSync(path.join(toolRoot, 'desktop', 'app.manifest'), 'utf8');
const manifestVersion = manifest.match(/assemblyIdentity version="([0-9.]+)"/)?.[1]?.replace(/\.0$/, '');
const desktopProject = fs.readFileSync(path.join(toolRoot, 'desktop', 'UEFNEntitlementManager.Desktop.csproj'), 'utf8');
const assemblyName = desktopProject.match(/<AssemblyName>([^<]+)<\/AssemblyName>/)?.[1];

const values = { canonical, packageVersion, manifestVersion };
for (const [label, value] of Object.entries(values)) {
  if (value !== canonical) throw new Error(`${label} is ${value ?? 'missing'}; expected ${canonical}.`);
}
if (assemblyName !== `UEFNEntitlementManager-${canonical}`) {
  throw new Error(`desktop executable is ${assemblyName ?? 'missing'}; expected UEFNEntitlementManager-${canonical}.`);
}

console.log(`Version consistency verified: ${canonical}`);
