const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { newerVersion, installerFor, latestRelease } = require('./desktop/updater');

const name = 'Lithuanian-Gym-Reviews-1.6.0-x64.exe';
const bytes = Buffer.from('sample installer bytes');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const release = { tag_name: 'v1.6.0', draft: false, prerelease: false,
  assets: [{ name, id: 123, state: 'uploaded', size: bytes.length, digest: `sha256:${digest}` }] };

test('only newer stable semantic versions trigger an update', () => {
  assert.equal(newerVersion('v1.6.0', '1.5.9'), true);
  assert.equal(newerVersion('v1.5.0', '1.5.0'), false);
  assert.equal(newerVersion('v1.4.9', '1.5.0'), false);
  assert.equal(newerVersion('v1.6.0-beta', '1.5.0'), false);
  assert.equal(newerVersion('broken', '1.5.0'), false);
});

test('release selection requires a verified Windows installer', () => {
  assert.deepEqual(installerFor(release), { version: '1.6.0', name, id: 123, size: bytes.length, digest });
  assert.equal(installerFor({ ...release, prerelease: true }), null);
  assert.equal(installerFor({ ...release, assets: [{ ...release.assets[0], digest: undefined }] }), null);
  assert.equal(installerFor({ ...release, assets: [{ ...release.assets[0], name: 'other.exe' }] }), null);
});

test('public release request needs no token and handles rate limits', async () => {
  let headers;
  const fakeFetch = async (_url, options) => { headers = options.headers; return Response.json(release); };
  assert.deepEqual(await latestRelease(fakeFetch), release);
  assert.equal(headers.Authorization, undefined);
  await assert.rejects(latestRelease(async () => new Response('', { status: 403 })), /rate limited/);
});
