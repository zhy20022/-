import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

const serverDir = join(process.cwd(), 'dist', 'server')
mkdirSync(serverDir, { recursive: true })

const distDir = join(process.cwd(), 'dist')
const assetsDir = join(distDir, 'assets')
const files = {
  '/index.html': {
    contentType: 'text/html; charset=utf-8',
    body: readFileSync(join(distDir, 'index.html'), 'utf-8'),
  },
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

for (const filename of readdirSync(assetsDir)) {
  const filePath = join(assetsDir, filename)
  const ext = extname(filename)
  const contentType = contentTypes[ext] || 'application/octet-stream'
  if (contentType.startsWith('text/') || contentType.includes('javascript') || contentType.includes('json') || contentType.includes('svg')) {
    files[`/assets/${filename}`] = {
      contentType,
      body: readFileSync(filePath, 'utf-8'),
    }
  } else {
    files[`/assets/${filename}`] = {
      contentType,
      base64: readFileSync(filePath).toString('base64'),
    }
  }
}

writeFileSync(
  join(serverDir, 'index.js'),
  `const FILES = ${JSON.stringify(files)};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function responseFor(pathname) {
  const file = FILES[pathname] || (pathname.includes('.') ? null : FILES['/index.html']);
  if (!file) return new Response('Not found', { status: 404 });
  const body = file.base64 ? decodeBase64(file.base64) : file.body;
  return new Response(body, {
    headers: {
      'content-type': file.contentType,
      'cache-control': pathname === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    return responseFor(url.pathname === '/' ? '/index.html' : url.pathname);
  },
};
`,
  'utf-8',
)

console.log('Created dist/server/index.js for Sites static hosting.')
