const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { newerVersion, installerFor, latestRelease, downloadInstaller } = require('./desktop/updater');

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

test('download verifies size and checksum without requiring a token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-update-'));
  const destination = path.join(dir, name);
  try {
    let redirectedOptions;
    const fakeFetch = async (url, options) => {
      if (String(url).includes('/releases/assets/')) {
        assert.equal(options.headers.Authorization, undefined);
        return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/example' } });
      }
      redirectedOptions = options;
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    };
    assert.equal(await downloadInstaller(installerFor(release), destination, fakeFetch), destination);
    assert.deepEqual(fs.readFileSync(destination), bytes);
    assert.equal(redirectedOptions.headers, undefined);
    fs.rmSync(destination);
    await assert.rejects(downloadInstaller({ ...installerFor(release), digest: '0'.repeat(64) }, destination, fakeFetch), /checksum/);
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.existsSync(`${destination}.part`), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('incomplete or unexpected downloads never leave an installable file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-update-'));
  try {
    const destination = path.join(dir, name);
    const item = installerFor(release);
    await assert.rejects(downloadInstaller(item, destination, async () => new Response(bytes.subarray(0, 4))), /incomplete/);
    assert.equal(fs.existsSync(destination), false);
    await assert.rejects(downloadInstaller(item, destination, async () =>
      new Response(null, { status: 302, headers: { location: 'https://example.com/installer.exe' } })), /location/);
    assert.equal(fs.existsSync(`${destination}.part`), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
