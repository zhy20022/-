import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const serverDir = join(process.cwd(), 'dist', 'server')
mkdirSync(serverDir, { recursive: true })

writeFileSync(
  join(serverDir, 'index.js'),
  `const INDEX_PATH = '/index.html';

async function fetchAsset(request, env) {
  if (!env || !env.ASSETS) {
    return new Response('Static asset binding is unavailable.', { status: 500 });
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await fetchAsset(request, env);
    if (response.status !== 404 || url.pathname.includes('.')) {
      return response;
    }
    return fetchAsset(new Request(new URL(INDEX_PATH, url.origin), request), env);
  },
};
`,
  'utf-8',
)

console.log('Created dist/server/index.js for Sites static hosting.')
