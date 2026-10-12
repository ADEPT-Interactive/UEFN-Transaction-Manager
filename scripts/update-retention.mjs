import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const VERSION = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
const versionPattern = new RegExp(`^${VERSION}$`);
const managedPatterns = [
  new RegExp(`^UEFN-Transaction-Manager-Setup-(${VERSION})\\.exe(?:\\.blockmap)?$`),
  new RegExp(`^UEFN-Transaction-Manager-(${VERSION})-Portable\\.zip$`),
  new RegExp(`^manifests/(${VERSION})\\.yml$`),
  new RegExp(`^manifests/portable-(${VERSION})\\.json$`),
];

function isOlder(version, current) {
  const a = version.split('.').map(BigInt);
  const b = current.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export function releaseObjectNames(version) {
  if (!versionPattern.test(version)) throw new Error('Retention requires a stable major.minor.patch version.');
  const installer = `UEFN-Transaction-Manager-Setup-${version}.exe`;
  return [installer, `${installer}.blockmap`, `manifests/${version}.yml`,
    `UEFN-Transaction-Manager-${version}-Portable.zip`, `manifests/portable-${version}.json`];
}

export function planRetention(objects, { prefix, version }) {
  if (prefix !== 'uem/stable') throw new Error('Retention is restricted to the exact uem/stable prefix.');
  releaseObjectNames(version);
  const boundary = `${prefix}/`;
  return objects.filter(object => {
    if (!object.Key?.startsWith(boundary)) return false;
    const name = object.Key.slice(boundary.length);
    const match = managedPatterns.map(pattern => name.match(pattern)).find(Boolean);
    return match && isOlder(match[1], version);
  });
}

// Origin reads bypass the public CDN: cached feeds must never authorize deletion.
async function assertCurrentFeeds(s3, args, expectedFeeds) {
  for (const name of ['latest.yml', 'portable-latest.json']) {
    const result = await s3.send(new GetObjectCommand({ Bucket: args.bucket, Key: `${args.prefix}/${name}` }));
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (!expectedFeeds[name] || !bytes.equals(expectedFeeds[name])) {
      throw new Error(`Retention stopped: origin ${name} differs from the verified release.`);
    }
  }
}

export async function pruneUpdates(s3, args, expectedFeeds, { dryRun = true, log = console.log } = {}) {
  if (args.bucket !== 'adept-software-updates') throw new Error('Retention is restricted to adept-software-updates.');
  planRetention([], args);
  const requiredNames = releaseObjectNames(args.version);
  const installerName = requiredNames[0];
  const installerFeed = expectedFeeds['latest.yml']?.toString('utf8') ?? '';
  const versions = [...installerFeed.matchAll(/^version:\s*['"]?([\d.]+)['"]?\s*$/gm)];
  const references = [...installerFeed.matchAll(/^\s*(?:-\s*)?(?:path|url):\s*['"]?([^\s'"]+)['"]?\s*$/gm)];
  const portable = JSON.parse(expectedFeeds['portable-latest.json']?.toString('utf8') ?? 'null');
  if (versions.length !== 1 || versions[0][1] !== args.version || references.length === 0
      || references.some(match => match[1] !== installerName)
      || portable?.version !== args.version || portable?.filename !== requiredNames[3]) {
    throw new Error('Retention stopped: verified feeds must reference only the requested release.');
  }
  await assertCurrentFeeds(s3, args, expectedFeeds);
  for (const name of requiredNames) {
    await s3.send(new HeadObjectCommand({ Bucket: args.bucket, Key: `${args.prefix}/${name}` }));
  }
  const objects = [];
  let continuationToken;
  const seenTokens = new Set();
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: args.bucket, Prefix: `${args.prefix}/`, ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents ?? []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && (!continuationToken || seenTokens.has(continuationToken))) {
      throw new Error('Retention stopped: incomplete or repeated R2 listing cursor.');
    }
    seenTokens.add(continuationToken);
  } while (continuationToken);
  const obsolete = planRetention(objects, args);
  const bytes = obsolete.reduce((sum, object) => sum + (object.Size ?? 0), 0);
  log(`Retention ${dryRun ? 'dry run' : 'cleanup'}: ${obsolete.length} obsolete objects, ${bytes} bytes; keeping ${args.version}, newer staged versions and unrecognized keys.`);
  for (const object of obsolete) log(`${dryRun ? 'Would delete' : 'Selected'} ${object.Key} (${object.Size ?? 0} bytes)`);
  if (!dryRun) {
    for (let offset = 0; offset < obsolete.length; offset += 1000) {
      await assertCurrentFeeds(s3, args, expectedFeeds);
      const batch = obsolete.slice(offset, offset + 1000).map(object => ({ Key: object.Key }));
      const result = await s3.send(new DeleteObjectsCommand({
        Bucket: args.bucket, Delete: { Objects: batch, Quiet: true },
      }));
      if (result.Errors?.length) {
        throw new Error(`R2 retention deletion failed: ${result.Errors.map(error => `${error.Key}: ${error.Code}`).join(', ')}`);
      }
      log(`Deleted ${batch.length} obsolete update objects.`);
    }
  }
  return { objects: obsolete.length, bytes, dryRun };
}
