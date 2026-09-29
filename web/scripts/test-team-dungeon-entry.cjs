// UI contract test with mocked HTTP responses; the worker is tested separately.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { once } = require('node:events')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const port = 5187
const origin = `http://127.0.0.1:${port}`

async function main() {
  const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, windowsHide: true, stdio: 'pipe' })
  const exited = once(server, 'exit')
  let browser, logs = ''
  for (const pipe of [server.stdout, server.stderr]) pipe.on('data', data => { logs = (logs + data).slice(-2000) })
  try {
    let up = false
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error(logs)
      try { if ((await fetch(origin)).ok) { up = true; break } } catch {}
      await delay(250)
    }
    assert(up, logs)
    const catalog = JSON.parse(readFileSync(path.resolve(root, '../data/content/characters.json'), 'utf8').replace(/^\uFEFF/, '')).characters
    const characters = catalog.slice(0, 20).map((c, i) => ({ ...c, id: `character-${i}`, characterConfigId: c.id, level: 100, exp: 0 }))
    const balance = JSON.parse(readFileSync(path.resolve(root, '../data/content/team-dungeon-balance.json'), 'utf8'))
    browser = await chromium.launch({ headless: true, channel: 'msedge' })
    for (const width of [1280, 390]) for (const [kind, size] of [['SQUAD', 5], ['TEAM', 20]]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      const page = await context.newPage()
      const errors = [], starts = []
      page.on('pageerror', e => errors.push(e.message))
      await page.addInitScript(() => {
        window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: window.location.origin }
        localStorage.setItem('gamer_online_current_session', JSON.stringify({ accessToken: 'online.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.test',
          player: { id: 'test-player', displayName: '测试账号', level: 100, gold: 100000 } }))
      })
      const dungeon = { dungeonId: 'test-dungeon', name: '测试团队副本', dungeonType: kind, attributeType: 'WATER', difficulty: 'normal',
        duration: balance[kind].duration, timeline: balance[kind], rewardConfig: { type: 'boss' } }
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url())
        let data = {}
        if (url.pathname.endsWith('/profile')) data = { characters, player: { id: 'test-player', gold: 100000 } }
        else if (url.pathname === '/api/dungeons') data = { dungeons: [dungeon] }
        else if (url.pathname.endsWith('/progress')) data = []
        else if (url.pathname.endsWith('/start')) {
          starts.push(route.request().postDataJSON())
          data = { battleSeed: 'test-seed' }
        } else if (url.pathname.includes('/battles/')) data = { ready: false, speed: 4, frame: { time: 0, units: [] }, units: {}, events: [] }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      })
      await page.goto(origin + '/#/dungeons')
      await page.getByRole('button', { name: kind === 'SQUAD' ? /5人本/ : /20人本/ }).click()
      await page.getByText(/第60秒随机登场一套Boss组合/).first().waitFor()
      await page.getByRole('button', { name: '开始挑战', exact: true }).click()
      const confirm = page.getByRole('button', { name: /^确认/ })
      assert(await confirm.isDisabled())
      for (let i = 0; i < size; i++) await page.locator('.character-select-card').nth(i).click()
      assert(await confirm.isEnabled())
      await page.screenshot({ path: path.join(process.env.TEMP, `team-entry-${kind}-${width}.png`), fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await confirm.click()
      await page.waitForURL('**/#/battle')
      assert.equal(starts.length, 1)
      assert.deepEqual(starts[0].characterIds, characters.slice(0, size).map(c => c.id))
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(JSON.stringify({ width, kind, selected: size, starts: starts.length, errors }))
      await context.close()
    }
  } finally {
    if (browser) await browser.close()
    if (server.exitCode === null) server.kill()
    await exited
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
