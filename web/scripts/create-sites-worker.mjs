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

function responseFor(pathname, request, env) {
  const file = FILES[pathname] || (pathname.includes('.') ? null : FILES['/index.html']);
  if (!file) return new Response('Not found', { status: 404 });
  let body = file.base64 ? decodeBase64(file.base64) : file.body;
  if (pathname === '/index.html' && typeof body === 'string') {
    const online = Boolean(env && env.GAME_API_ORIGIN);
    const sameOrigin = new URL(request.url).origin;
    const runtimeConfig = {
      formalOnline: online,
      staticDemo: !online,
      apiBase: online ? sameOrigin : '',
      socketUrl: online ? sameOrigin : '',
    };
    const runtimeScript = '<script>window.__GAMER_RUNTIME_CONFIG__=' + JSON.stringify(runtimeConfig).replace(/</g, '\\u003c') + ';<\\/script>';
    body = body.replace('</head>', runtimeScript + '</head>');
  }
  return new Response(body, {
    headers: {
      'content-type': file.contentType,
      'cache-control': pathname === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    },
  });
}

async function proxyOnlineRequest(request, env) {
  const origin = env && env.GAME_API_ORIGIN ? String(env.GAME_API_ORIGIN).replace(/\\\/$/, '') : '';
  if (!origin) {
    return Response.json({ statusCode: 503, message: 'The formal online API is not configured.' }, { status: 503 });
  }
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin + '/');
  const headers = new Headers(request.headers);
  headers.delete('host');
  return fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
      return proxyOnlineRequest(request, env);
    }
    return responseFor(url.pathname === '/' ? '/index.html' : url.pathname, request, env);
  },
};
`,
  'utf-8',
)

console.log('Created dist/server/index.js for Sites static hosting.')
