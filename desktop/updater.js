const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'povilaspiesina/lithuanian-gym-reviews';
const API = `https://api.github.com/repos/${REPO}`;

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}
function newerVersion(remote, current) {
  const a = versionParts(remote);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
function installerFor(release) {
  if (!release || release.draft || release.prerelease || !versionParts(release.tag_name)) return null;
  const expected = `Lithuanian-Gym-Reviews-${release.tag_name.replace(/^v/, '')}-x64.exe`;
  const asset = release.assets?.find(item => item.name === expected && item.state === 'uploaded');
  if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
      !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) return null;
  return { version: release.tag_name.replace(/^v/, ''), name: expected, id: asset.id,
    size: asset.size, digest: asset.digest.slice(7).toLowerCase() };
}
async function githubFetch(url, accept, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: {
    Accept: accept, 'User-Agent': 'lithuanian-gym-reviews',
    'X-GitHub-Api-Version': '2022-11-28',
  }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if (response.status === 403) throw new Error('GitHub update checks are temporarily rate limited. Try again later.');
  if (response.status === 404) throw new Error('No published GitHub release was found.');
  if (!response.ok && (response.status < 300 || response.status >= 400)) throw new Error(`GitHub update request failed (${response.status}).`);
  return response;
}
async function latestRelease(fetchImpl = fetch) {
  const response = await githubFetch(`${API}/releases/latest`, 'application/vnd.github+json', fetchImpl);
  if (response.status !== 200) throw new Error('Unexpected GitHub release response.');
  return response.json();
}
async function downloadInstaller(asset, destination, fetchImpl = fetch) {
  const target = path.resolve(destination);
  const temporary = `${target}.part`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(temporary, { force: true });
  try {
    let response = await githubFetch(`${API}/releases/assets/${asset.id}`, 'application/octet-stream', fetchImpl);
    for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
      if (hops >= 4) throw new Error('Too many GitHub download redirects.');
      const location = response.headers.get('location');
      const url = new URL(location);
      if (url.protocol !== 'https:' || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github.com'].includes(url.hostname)) {
        throw new Error('Unexpected GitHub download location.');
      }
      response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(900000) });
    }
    if (!response.ok || !response.body || /json/i.test(response.headers.get('content-type') || '')) {
      throw new Error('GitHub did not return an installer.');
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { mode: 0o600 }));
    const actualSize = fs.statSync(temporary).size;
    if (actualSize !== asset.size) throw new Error('Installer download is incomplete.');
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(temporary), hash);
    const digest = hash.digest('hex');
    if (digest !== asset.digest) throw new Error('Installer checksum did not match GitHub.');
    fs.renameSync(temporary, target);
    return target;
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
module.exports = { newerVersion, installerFor, latestRelease, downloadInstaller };
