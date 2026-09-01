import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalize = value => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const runtimeValues = new Set([
  normalize(os.homedir()),
  normalize(process.cwd()),
  normalize(root),
  normalize(process.env.USERPROFILE ?? ''),
]);
runtimeValues.delete('');

const tracked = childProcess.execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const findings = [];
const genericMachinePath = /\b[A-Za-z]:[\\/]Users[\\/]+(?!<user-profile>|<username>|user(?:name)?(?:[\\/]|$)|example(?:[\\/]|$)|test(?:[\\/]|$))[^\s`"'<>]+/i;
const projectPathHint = /\b[A-Za-z]:[\\/]+(?:Users|Documents)[\\/]+[^\r\n`"<>]*UEFN[ _-]+Projects?/i;

for (const relative of tracked) {
  const filePath = path.join(root, relative);
  let text;
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) continue;
    text = buffer.toString('utf8');
  } catch {
    continue;
  }
  const normalizedText = normalize(text);
  for (const value of runtimeValues) {
    if (value.length >= 8 && normalizedText.includes(value)) findings.push(`${relative}: contains a current machine-specific runtime path`);
  }
  if (genericMachinePath.test(text)) findings.push(`${relative}: contains a user-profile path; use a generic placeholder`);
  if (projectPathHint.test(text)) findings.push(`${relative}: contains a machine-specific UEFN project path; use a generic placeholder`);
}

if (findings.length) {
  console.error('Repository privacy check failed:');
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(`Repository privacy check passed for ${tracked.length} tracked files.`);
