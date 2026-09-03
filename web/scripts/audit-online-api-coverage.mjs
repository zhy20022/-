import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const menu = readFileSync(resolve(root, 'src/pages/MainMenu.tsx'), 'utf8');
const coverage = readFileSync(resolve(root, 'src/services/onlineFeatureCoverage.ts'), 'utf8');
const expectedRoutes = [
  '/', '/characters', '/dungeons', '/gacha', '/crafting', '/inventory', '/online-progress',
  '/shop', '/social', '/world-boss', '/quests', '/achievements', '/enhancement', '/admin', '/online-admin',
];
const missing = expectedRoutes.filter((route) => !coverage.includes(`'${route}':`));
if (missing.length) throw new Error(`main-city routes missing online coverage records: ${missing.join(', ')}`);

const pending = [...coverage.matchAll(/'([^']+)': \{ status: 'pending'/g)].map((match) => match[1]);
for (const route of pending) {
  if (!menu.includes(`openMainRoute('${route}')`)) {
    throw new Error(`pending route ${route} is not guarded by openMainRoute`);
  }
}

console.log(JSON.stringify({
  ok: true,
  auditedRoutes: expectedRoutes.length,
  guardedPendingRoutes: pending,
  readyOrPartialRoutes: expectedRoutes.filter((route) => !pending.includes(route)),
}, null, 2));
