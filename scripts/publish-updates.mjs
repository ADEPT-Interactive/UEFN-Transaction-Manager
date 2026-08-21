import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const DEFAULT_BUCKET = 'adept-software-updates';
const DEFAULT_PREFIX = 'uem/stable';
const DEFAULT_PUBLIC_URL = 'https://updates.adeptinteractive.net/';

function usage() {
  console.error('Usage: node scripts/publish-updates.mjs <stage|verify|promote|delete-prefix> --version <version> [options]');
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || !['stage', 'verify', 'promote', 'delete-prefix'].includes(command)) usage();
  const args = { command, bucket: DEFAULT_BUCKET, prefix: DEFAULT_PREFIX, publicUrl: DEFAULT_PUBLIC_URL, releaseDirectory: 'release' };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--') || index + 1 >= rest.length) usage();
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[name] = rest[++index];
  }
  if (!args.version && command !== 'delete-prefix') usage();
  return args;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function client() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv('ADEPT_UPDATES_R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('ADEPT_UPDATES_R2_SECRET_ACCESS_KEY'),
    },
  });
}

function objectKey(prefix, name) { return `${prefix.replace(/^\/+|\/+$/g, '')}/${name}`; }
function publicObjectUrl(publicUrl, key) { return new URL(key, publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`).toString(); }

async function releaseFiles(args) {
  const root = path.resolve(args.releaseDirectory);
  const installerName = `UEFN-Entitlement-Manager-Setup-${args.version}.exe`;
  const blockmapName = `${installerName}.blockmap`;
  const manifestName = `${args.version}.yml`;
  const entries = [
    { local: path.join(root, installerName), name: installerName, type: 'application/vnd.microsoft.portable-executable', cache: 'public, max-age=31536000, immutable' },
    { local: path.join(root, blockmapName), name: blockmapName, type: 'application/octet-stream', cache: 'public, max-age=31536000, immutable' },
    { local: path.join(root, 'latest.yml'), name: `manifests/${manifestName}`, type: 'text/yaml; charset=utf-8', cache: 'public, max-age=31536000, immutable' },
  ];
  for (const entry of entries) entry.body = await fs.readFile(entry.local);
  return entries;
}

async function remoteVersionedFiles(args) {
  const installerName = `UEFN-Entitlement-Manager-Setup-${args.version}.exe`;
  const names = [installerName, `${installerName}.blockmap`, `manifests/${args.version}.yml`];
  const entries = [];
  for (const name of names) {
    const response = await fetch(publicObjectUrl(args.publicUrl, objectKey(args.prefix, name)));
    if (response.status !== 200) throw new Error(`Public versioned object is unavailable: ${name} (${response.status})`);
    entries.push({ name, body: Buffer.from(await response.arrayBuffer()) });
  }
  return entries;
}

function sha256(body) { return crypto.createHash('sha256').update(body).digest('hex'); }

async function putVersioned(s3, args, entries) {
  for (const entry of entries) {
    const key = objectKey(args.prefix, entry.name);
    await s3.send(new PutObjectCommand({ Bucket: args.bucket, Key: key, Body: entry.body, ContentType: entry.type, CacheControl: entry.cache }));
    console.log(`Uploaded immutable object ${key} (${entry.body.length} bytes, sha256 ${sha256(entry.body)})`);
  }
}

async function headPublic(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  return response;
}

async function verifyPublicObject(url, expectedBody, label, { range = false } = {}) {
  const head = await headPublic(url);
  if (head.status !== 200) throw new Error(`${label} public HEAD returned ${head.status}: ${url}`);
  const cacheControl = head.headers.get('cache-control') ?? '';
  const response = await fetch(url);
  if (response.status !== 200) throw new Error(`${label} public GET returned ${response.status}: ${url}`);
  const actual = Buffer.from(await response.arrayBuffer());
  if (sha256(actual) !== sha256(expectedBody) || actual.length !== expectedBody.length) throw new Error(`${label} public bytes do not match the staged object.`);
  console.log(`Verified public ${label}: 200, ${actual.length} bytes, sha256 ${sha256(actual)}, cache-control=${cacheControl || '(none)'}`);
  if (range) {
    const ranged = await fetch(url, { headers: { Range: 'bytes=0-15' } });
    if (ranged.status !== 206) throw new Error(`${label} does not support the required HTTP range request (status ${ranged.status}).`);
    console.log(`Verified public ${label} HTTP range support: 206.`);
  }
  return { head, body: actual };
}

async function verifyUnknown(publicUrl, prefix) {
  const url = publicObjectUrl(publicUrl, objectKey(prefix, `missing-${Date.now()}.yml`));
  const response = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  if (response.status !== 404) throw new Error(`Unknown update object did not return 404: ${response.status}`);
  console.log('Verified unknown public update object returns 404.');
}

async function verifyVersioned(args, entries) {
  const results = [];
  for (const entry of entries) {
    const url = publicObjectUrl(args.publicUrl, objectKey(args.prefix, entry.name));
    results.push(await verifyPublicObject(url, entry.body, entry.name, { range: entry.name.endsWith('.exe') }));
  }
  const manifest = entries.find(entry => entry.name.startsWith('manifests/'));
  const manifestText = manifest.body.toString('utf8');
  const installer = entries.find(entry => entry.name.endsWith('.exe'));
  if (!manifestText.includes(installer.name)) throw new Error('Immutable manifest does not reference the versioned installer.');
  if (!manifestText.includes('version: ' + args.version)) throw new Error('Immutable manifest does not declare the requested version.');
  await verifyUnknown(args.publicUrl, args.prefix);
  return results;
}

async function promote(args, entries) {
  await verifyVersioned(args, entries);
  const installer = entries.find(entry => entry.name.endsWith('.exe'));
  if (args.githubInstallerUrl) {
    const githubResponse = await fetch(args.githubInstallerUrl);
    if (githubResponse.status !== 200) throw new Error(`GitHub human installer returned ${githubResponse.status}.`);
    const githubBody = Buffer.from(await githubResponse.arrayBuffer());
    if (sha256(githubBody) !== sha256(installer.body)) throw new Error('GitHub human installer bytes do not match the staged R2 installer.');
    console.log(`Verified GitHub human installer byte identity: sha256 ${sha256(githubBody)}`);
  }
  const sourceKey = objectKey(args.prefix, `manifests/${args.version}.yml`);
  const latestKey = objectKey(args.prefix, 'latest.yml');
  const s3 = client();
  await s3.send(new CopyObjectCommand({
    Bucket: args.bucket,
    CopySource: `${args.bucket}/${sourceKey}`,
    Key: latestKey,
    MetadataDirective: 'REPLACE',
    ContentType: 'text/yaml; charset=utf-8',
    CacheControl: 'no-store, no-cache, must-revalidate',
  }));
  console.log(`Promoted ${sourceKey} to ${latestKey} as the final mutable publication step.`);
  const latest = await verifyPublicObject(publicObjectUrl(args.publicUrl, latestKey), entries.find(entry => entry.name.startsWith('manifests/')).body, 'latest.yml');
  const cacheControl = latest.head.headers.get('cache-control') ?? '';
  if (!/no-store|no-cache|must-revalidate/i.test(cacheControl)) throw new Error(`latest.yml is missing no-cache policy: ${cacheControl}`);
  console.log(`Verified latest.yml mutable cache policy: ${cacheControl}`);
}

async function deletePrefix(args) {
  if (!args.prefix.startsWith('uem/test/')) throw new Error('delete-prefix is restricted to uem/test/<unique-run-id>/ prefixes.');
  const s3 = client();
  let continuationToken;
  do {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: args.bucket, Prefix: args.prefix, ContinuationToken: continuationToken }));
    const objects = (listed.Contents ?? []).filter(object => object.Key).map(object => ({ Key: object.Key }));
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: args.bucket, Delete: { Objects: objects, Quiet: true } }));
      console.log(`Deleted ${objects.length} test objects under ${args.prefix}.`);
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

const args = parseArgs(process.argv.slice(2));
if (args.command === 'delete-prefix') await deletePrefix(args);
else {
  const entries = args.command === 'stage' ? await releaseFiles(args) : await remoteVersionedFiles(args);
  if (args.command === 'stage') {
    await putVersioned(client(), args, entries);
    await verifyVersioned(args, entries);
  } else if (args.command === 'verify') {
    await verifyVersioned(args, entries);
  } else if (args.command === 'promote') {
    await promote(args, entries);
  }
}
