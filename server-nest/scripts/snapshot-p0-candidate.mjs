import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = resolve('..');
const artifactRoot = resolve(process.env.E2E_ARTIFACT_DIR || process.env.TEMP, 'gamer-p0-final-20261008');
const source = resolve(artifactRoot, 'candidate-source');
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
const critical = [
  'server-nest/src/auth/active-account.guard.ts',
  'server-nest/src/database/migrations/1788513000000-MultiplayerRoomPresence.ts',
  'server-nest/scripts/e2e-multiplayer-room-browser.mjs',
  'server-nest/scripts/e2e-multiplayer-delivery.mjs',
  'server-nest/scripts/e2e-p0-delivery.mjs',
  'server-nest/scripts/verify-p0-final.mjs',
  'server-nest/scripts/snapshot-p0-candidate.mjs',
];
const files = [...new Set([...git(['ls-files', '-z']).split('\0'), ...critical])].filter(Boolean).sort();
const manifest = { head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
  createdAt: new Date().toISOString(), schemaVersion: (await readFile(resolve(root, 'server-nest/src/database/schema-version.ts'), 'utf8'))
    .match(/CURRENT_SCHEMA_VERSION\s*=\s*'([^']+)'/)[1],
  dirtyStatus: git(['status', '--short']), untrackedCriticalFiles: critical, source, files: [] };
await mkdir(source, { recursive: true });
for (const path of files) {
  assert(!path.includes('..') && !path.startsWith('/') && !/^[A-Za-z]:/.test(path));
  const bytes = await readFile(resolve(root, path));
  const target = resolve(source, path);
  assert(target.startsWith(source + '\\') || target.startsWith(source + '/'));
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, path), target);
  manifest.files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
manifest.sourceSha256 = createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex');
await writeFile(resolve(artifactRoot, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ head: manifest.head, schema: manifest.schemaVersion, files: files.length,
  sourceSha256: manifest.sourceSha256, source }, null, 2));
