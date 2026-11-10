const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { mkdtemp } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { chromium } = require('../../server-nest/node_modules/playwright')
const web = path.resolve(__dirname, '..')
const port = process.env.STAGE2B_BROWSER_PORT || '3063'
const origin = `http://127.0.0.1:${port}`
const player = id => ({ id, displayName: id, level: 1, gold: 100000 })
const session = (id, provider = 'password') => ({
  accessToken: `online.${Buffer.from(JSON.stringify({ playerId: id, exp: 9999999999 })).toString('base64url')}.synthetic`,
  user: { id: `${id}-user`, provider, status: 'active' },
  player: player(id),
})
let server, browser
const passed = []

async function check(name, run) {
  await run()
  passed.push(name)
  console.log(`PASS ${name}`)
}

async function context({ stale = false, failure = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const calls = [], errors = []
  let fail = failure
  page.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(({ stale }) => {
    window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: location.origin }
    if (stale && !localStorage.getItem('gamer_stage2b_seeded')) {
      localStorage.setItem('gamer_stage2b_seeded', 'true')
      localStorage.setItem('gamer_online_current_session', JSON.stringify({
        accessToken: 'online.' + btoa(JSON.stringify({ exp: 1 })) + '.synthetic', player: { id: 'old' },
      }))
      localStorage.setItem('gamer_online_access_token', 'expired-synthetic')
    }
  }, { stale })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    calls.push({ path: url.pathname, authorization: request.headers().authorization, body: request.postData() })
    let data = {}
    let status = 200
    if (/\/auth\/(login|guest|register)$/.test(url.pathname)) {
      await delay(100)
      status = fail || 201
      data = fail ? { message: `synthetic-${fail}` }
        : session(url.pathname.endsWith('/guest') ? 'guest-player' : 'account-player',
          url.pathname.endsWith('/guest') ? 'guest' : 'password')
    } else if (url.pathname.endsWith('/profile')) {
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gamer_online_current_session')))
      data = { player: stored.player, characters: [], inventory: [] }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  })
  return { context, page, calls, errors, setFailure: value => { fail = value } }
}

async function main() {
  const cache = await mkdtemp(path.join(tmpdir(), 'gamer-stage2b-vite-'))
  // Separate cache/output; never start Nest, call a real API, or overwrite existing evidence.
  server = spawn(process.execPath, ['-e', `import('vite').then(async ({createServer}) => {const {default:react}=await import('@vitejs/plugin-react');return createServer({configFile:false,envFile:false,plugins:[react()],server:{host:'127.0.0.1',port:${Number(port)},strictPort:true},cacheDir:${JSON.stringify(cache)}}).then(s=>s.listen())})`],
    { cwd: web, windowsHide: true, stdio: 'pipe' })
  let output = ''
  server.stdout.on('data', data => { output += data })
  server.stderr.on('data', data => { output += data })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output)
    try { if ((await fetch(origin)).ok) { ready = true; break } } catch {}
    await delay(100)
  }
  assert(ready, output)
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  await check('expired session -> explicit guest; duplicate UI input -> one request; logout -> password; reload restores same account', async () => {
    const { context: ctx, page, calls, errors } = await context({ stale: true })
    try {
      await page.goto(origin)
      const guest = page.getByRole('button', { name: '游客登录', exact: true })
      await guest.waitFor()
      assert.equal(calls.filter(row => /\/auth\//.test(row.path)).length, 0)
      await guest.evaluate(button => { button.click(); button.click() })
      await page.locator('.menu-buttons').waitFor()
      assert.equal(calls.filter(row => row.path.endsWith('/auth/guest')).length, 1)
      assert.equal(calls.find(row => row.path.endsWith('/auth/guest')).authorization, undefined)
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.gamer_online_current_session).user.provider), 'guest')
      await page.getByRole('button', { name: '登出', exact: true }).click()
      await page.locator('input[type="text"]').fill('account')
      await page.locator('input[type="password"]').fill('synthetic-password')
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.locator('.menu-buttons').waitFor()
      assert.equal(calls.find(row => row.path.endsWith('/auth/login')).authorization, undefined)
      await page.reload()
      await page.locator('.menu-buttons').waitFor()
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.gamer_online_current_session).player.id), 'account-player')
      assert.deepEqual(errors, [])
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1)
    } finally { await ctx.close() }
  })
  for (const status of [403, 500]) {
    await check(`guest HTTP ${status} stays on login, displays error and supports retry`, async () => {
      const { context: ctx, page, calls, errors, setFailure } = await context({ failure: status })
      try {
        await page.goto(origin)
        await page.getByRole('button', { name: '游客登录', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: `synthetic-${status}` }).waitFor()
        assert.equal(await page.locator('.menu-buttons').count(), 0)
        assert.equal(calls.filter(row => /\/auth\//.test(row.path)).length, 1)
        setFailure(0)
        await page.getByRole('button', { name: '游客登录', exact: true }).click()
        await page.locator('.menu-buttons').waitFor()
        assert.deepEqual(errors, [])
      } finally { await ctx.close() }
    })
  }
  console.log(JSON.stringify({ passed: passed.length, failed: 0, method: 'headless browser + HTTP Mock; not real online E2E' }))
}

main().catch(error => { console.error(error.stack); process.exitCode = 1 })
  .finally(async () => {
    if (browser) await browser.close()
    if (server && server.exitCode === null) {
      const done = once(server, 'exit')
      server.kill()
      await done
    }
  })
