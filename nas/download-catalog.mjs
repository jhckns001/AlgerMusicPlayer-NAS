import { readFile, mkdir, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = path.dirname(fileURLToPath(import.meta.url));
const platformIndex = process.argv.indexOf('--platform');
const platform = platformIndex >= 0 ? process.argv[platformIndex + 1] : 'linux';
if (!['linux', 'windows'].includes(platform) || process.arch !== 'x64') {
  throw new Error('This release supports Linux x86_64 and Windows x64 only.');
}
const artifacts = JSON.parse(await readFile(path.join(folder, 'catalog-artifacts.json'), 'utf8'));
const asset = artifacts[platform];
const output = path.join(folder, 'bin', platform === 'windows' ? 'tuneweave.exe' : 'tuneweave');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(path.dirname(output), { recursive: true });
let valid = existsSync(output) && digest(await readFile(output)) === asset.sha256;
if (!valid) {
  const response = await fetch(asset.source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Official runtime download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) throw new Error('Runtime checksum mismatch');
  const temporary = output + '.download';
  try { await writeFile(temporary, bytes); await rename(temporary, output); }
  finally { if (existsSync(temporary)) await unlink(temporary); }
  valid = true;
}
if (platform === 'linux' && process.platform !== 'win32') await chmod(output, 0o755);
console.log(`TuneWeave ${asset.version}: ${platform} checksum verified (${asset.sha256})`);
