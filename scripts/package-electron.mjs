import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const separator = argument.indexOf('=');
  return separator > 0 ? [argument.slice(2, separator), argument.slice(separator + 1)] : [argument.slice(2), ''];
}));
const appDir = path.resolve(options.appDir ?? '');
const outputDir = path.resolve(options.outputDir ?? '');
const icon = path.resolve(options.icon ?? '');
const version = options.version ?? '';
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronVersion = JSON.parse(fs.readFileSync(path.join(toolRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
if (!fs.existsSync(path.join(appDir, 'package.json')) || !fs.existsSync(icon) || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Usage: package-electron.mjs --appDir=<path> --outputDir=<path> --icon=<ico> --version=<semver>');
}

const executableName = `UEFNEntitlementManager-${version}`;
const outputPaths = await packager({
  dir: appDir,
  out: outputDir,
  name: 'UEFN Entitlement Manager',
  executableName,
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  overwrite: true,
  prune: false,
  asar: false,
  icon,
  appVersion: version,
  buildVersion: version,
  win32metadata: {
    CompanyName: 'AD3PT Interactive Inc.',
    FileDescription: 'UEFN Entitlement Manager',
    InternalName: executableName,
    OriginalFilename: `${executableName}.exe`,
    ProductName: 'UEFN Entitlement Manager',
  },
});
if (outputPaths.length !== 1 || !fs.existsSync(path.join(outputPaths[0], `${executableName}.exe`))) {
  throw new Error(`Electron packager did not produce the expected Windows x64 executable: ${outputPaths.join(', ')}`);
}
process.stdout.write(`${outputPaths[0]}\n`);
