import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { planRetention, pruneUpdates, releaseObjectNames } from '../scripts/update-retention.mjs';
import { promote } from '../scripts/publish-updates.mjs';

const args = { bucket: 'adept-software-updates', prefix: 'uem/stable', version: '4.4.1', publicUrl: 'https://updates.example/' };
const installer = releaseObjectNames(args.version)[0];
const feeds = {
  'latest.yml': Buffer.from(`version: 4.4.1\nfiles:\n  - url: ${installer}\npath: ${installer}\n`),
  'portable-latest.json': Buffer.from(JSON.stringify({ version: '4.4.1', filename: releaseObjectNames(args.version)[3] })),
};
const object = (name, Size = 100) => ({ Key: `uem/stable/${name}`, Size });
const older = releaseObjectNames('4.4.0').map(name => object(name));
const quiet = { log() {} };

function fakeS3({ pages = [{ Contents: older }], getFeed = name => feeds[name], failHead = false, errors = [], failList = false } = {}) {
  const calls = [];
  let pageIndex = 0;
  return {
    calls,
    async send(command) {
      const name = command.constructor.name;
      calls.push({ name, input: command.input });
      if (name === 'GetObjectCommand') {
        const body = getFeed(command.input.Key.split('/').at(-1), calls);
        if (!body) throw new Error('missing feed');
        return { Body: { transformToByteArray: async () => body } };
      }
      if (name === 'HeadObjectCommand') {
        if (failHead) throw new Error('missing current payload');
        return {};
      }
      if (name === 'ListObjectsV2Command') {
        if (failList) throw new Error('list denied');
        return pages[pageIndex++];
      }
      if (name === 'DeleteObjectsCommand') return { Errors: errors };
      if (name === 'CopyObjectCommand') return {};
      throw new Error(`Unexpected ${name}`);
    },
  };
}
const deletes = s3 => s3.calls.filter(call => call.name === 'DeleteObjectsCommand');

test('only recognized older release objects are pruned, using numeric version ordering', () => {
  const old = ['4.0.1', '4.3.10', '3.20.30'].flatMap(v => releaseObjectNames(v).map(name => object(name)));
  const preserved = ['4.4.1', '4.4.2', '4.10.0', '5.0.0'].flatMap(v => releaseObjectNames(v).map(name => object(name)));
  preserved.push(...['latest.yml', 'portable-latest.json', 'notes.txt', 'manifests/latest.yml',
    'manifests/4.3.0-beta.yml', 'UEFN-Transaction-Manager-Setup-04.3.0.exe',
    'subdir/UEFN-Transaction-Manager-Setup-4.0.1.exe', 'UEFN-Transaction-Manager-Installer.exe'].map(name => object(name)));
  preserved.push({ Key: 'uem/stable-other/UEFN-Transaction-Manager-Setup-4.0.1.exe' },
    { Key: 'uem/beta/UEFN-Transaction-Manager-Setup-4.0.1.exe' }, { Key: 'other/stable/manifests/4.0.1.yml' });
  assert.deepEqual(planRetention([...old, ...preserved], args), old);
});

test('dry run lists all pages without deleting and reports reclaimed bytes', async () => {
  const s3 = fakeS3({ pages: [{ Contents: older.slice(0, 2), IsTruncated: true, NextContinuationToken: 'next' }, { Contents: older.slice(2) }] });
  assert.deepEqual(await pruneUpdates(s3, args, feeds, quiet), { objects: 5, bytes: 500, dryRun: true });
  assert.equal(deletes(s3).length, 0);
  const lists = s3.calls.filter(call => call.name === 'ListObjectsV2Command');
  assert.equal(lists[0].input.Prefix, 'uem/stable/');
  assert.equal(lists[1].input.ContinuationToken, 'next');
});

test('applied cleanup deletes only obsolete files and is idempotent', async () => {
  const s3 = fakeS3({ pages: [{ Contents: [...older, ...releaseObjectNames('4.4.2').map(name => object(name))] }, { Contents: [] }] });
  assert.equal((await pruneUpdates(s3, args, feeds, { ...quiet, dryRun: false })).objects, 5);
  assert.deepEqual(deletes(s3)[0].input.Delete.Objects, older.map(({ Key }) => ({ Key })));
  assert.equal((await pruneUpdates(s3, args, feeds, { ...quiet, dryRun: false })).objects, 0);
  assert.equal(deletes(s3).length, 1);
});

test('deletes are split into API batches of at most 1000 after complete listing', async () => {
  const objects = Array.from({ length: 1005 }, (_, i) => object(`manifests/1.0.${i}.yml`));
  const s3 = fakeS3({ pages: [{ Contents: objects.slice(0, 1000), IsTruncated: true, NextContinuationToken: 'next' }, { Contents: objects.slice(1000) }] });
  await pruneUpdates(s3, args, feeds, { ...quiet, dryRun: false });
  assert.deepEqual(deletes(s3).map(call => call.input.Delete.Objects.length), [1000, 5]);
  assert.ok(s3.calls.findIndex(call => call.name === 'DeleteObjectsCommand') > s3.calls.findLastIndex(call => call.name === 'ListObjectsV2Command'));
});

for (const [label, options] of [
  ['missing feed', { getFeed: () => undefined }],
  ['split installer and portable versions', { getFeed: name => name === 'latest.yml' ? feeds[name] : Buffer.from('{}') }],
  ['missing current payload', { failHead: true }],
  ['failed listing', { failList: true }],
  ['truncated listing without cursor', { pages: [{ Contents: older, IsTruncated: true }] }],
  ['repeated listing cursor', { pages: [{ IsTruncated: true, NextContinuationToken: 'same' }, { IsTruncated: true, NextContinuationToken: 'same' }] }],
  ['feed changes during listing', { getFeed: (name, calls) => calls.some(call => call.name === 'ListObjectsV2Command') ? Buffer.from('changed') : feeds[name] }],
]) {
  test(`${label} aborts without deletion`, async () => {
    const s3 = fakeS3(options);
    await assert.rejects(pruneUpdates(s3, args, feeds, { ...quiet, dryRun: false }));
    assert.equal(deletes(s3).length, 0);
  });
}

test('per-object delete failures fail cleanup instead of reporting success', async () => {
  const s3 = fakeS3({ errors: [{ Key: older[0].Key, Code: 'AccessDenied' }] });
  await assert.rejects(pruneUpdates(s3, args, feeds, { ...quiet, dryRun: false }), /AccessDenied/);
});

test('bucket, prefix, and version guards reject before remote operations', async () => {
  for (const overrides of [{ bucket: 'other' }, { prefix: 'uem' }, { prefix: 'uem/stable/' }, { prefix: 'uem/test/run' }, { version: '4.4.1-beta' }, { version: '../4.4.1' }]) {
    const s3 = fakeS3();
    await assert.rejects(pruneUpdates(s3, { ...args, ...overrides }, feeds));
    assert.equal(s3.calls.length, 0);
  }
});

test('feed references to another payload fail closed', async () => {
  const s3 = fakeS3();
  const unsafe = { ...feeds, 'latest.yml': Buffer.from('version: 4.4.1\npath: UEFN-Transaction-Manager-Setup-4.4.0.exe\n') };
  await assert.rejects(pruneUpdates(s3, args, unsafe), /must reference only/);
  assert.equal(s3.calls.length, 0);
});

test('promotion prunes only after both mutable feeds pass public verification', async () => {
  const exe = Buffer.from('installer');
  const zip = Buffer.from('portable');
  const portable = Buffer.from(JSON.stringify({ version: args.version, filename: releaseObjectNames(args.version)[3], size: zip.length, sha256: crypto.createHash('sha256').update(zip).digest('hex') }));
  const entries = releaseObjectNames(args.version).map((name, i) => ({ name, body: [exe, Buffer.from('blockmap'), feeds['latest.yml'], zip, portable][i] }));
  const expected = { ...feeds, 'portable-latest.json': portable };
  const savedFetch = globalThis.fetch;
  const savedLog = console.log;
  console.log = () => {};
  try {
    for (const failure of ['versioned', 'github', 'installer-copy', 'portable-copy', 'latest.yml', 'portable-latest.json', 'cache', null]) {
      const s3 = fakeS3({ getFeed: name => expected[name] });
      const send = s3.send.bind(s3);
      s3.send = async command => {
        if (command.constructor.name === 'CopyObjectCommand'
            && ((failure === 'installer-copy' && command.input.Key.endsWith('/latest.yml'))
              || (failure === 'portable-copy' && command.input.Key.endsWith('/portable-latest.json')))) {
          throw new Error('promotion copy failed');
        }
        return send(command);
      };
      const verified = new Set();
      globalThis.fetch = async (url, options = {}) => {
        const name = new URL(url).pathname.replace('/uem/stable/', '');
        if (name.startsWith('missing-')) return new Response(null, { status: 404 });
        if (new URL(url).pathname === '/human.exe') return new Response(failure === 'github' ? 'different installer' : exe);
        const body = expected[name] ?? entries.find(entry => entry.name === name)?.body;
        if (!body) throw new Error(`Unexpected URL ${url}`);
        if ((failure === 'versioned' && name === installer) || failure === name) return new Response(null, { status: 503 });
        const mutable = name in expected;
        const cache = mutable && failure !== 'cache' ? 'no-store, no-cache, must-revalidate' : 'public, max-age=31536000, immutable';
        if (mutable && !options.method) verified.add(name);
        return new Response(options.method === 'HEAD' ? null : body, { status: options.headers?.Range ? 206 : 200, headers: { 'cache-control': cache } });
      };
      if (failure) {
        await assert.rejects(promote({ ...args, githubInstallerUrl: 'https://updates.example/human.exe' }, entries, s3));
        assert.equal(deletes(s3).length, 0, failure);
        assert.equal(s3.calls.filter(call => call.name === 'ListObjectsV2Command').length, 0, failure);
      } else {
        await promote({ ...args, githubInstallerUrl: 'https://updates.example/human.exe' }, entries, s3);
        assert.deepEqual([...verified].sort(), ['latest.yml', 'portable-latest.json']);
        assert.equal(s3.calls.filter(call => call.name === 'CopyObjectCommand').length, 2);
        assert.equal(deletes(s3).length, 1);
      }
    }
  } finally {
    globalThis.fetch = savedFetch;
    console.log = savedLog;
  }
});
