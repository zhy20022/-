const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const { chromium } = require(path.join(root, 'server-nest/node_modules/playwright'))
const output = path.resolve(process.env.E2E_ARTIFACT_DIR || process.env.TEMP, 'gamer-element-visual')
const keys = ['FIRE', 'WATER', 'EARTH', 'WOOD', 'THUNDER', 'WIND', 'LIGHT', 'DARK']
const player = { id: 'visual-player', displayName: 'Visual contract', level: 1, gold: 100 }
const characters = keys.map((attributeType, i) => ({
  id: `visual-character-${i}`, characterConfigId: `char_00${i + 1}_visual`, name: attributeType,
  attributeType, professionType: 'PHYSICAL_MELEE_DPS', level: 1, equipment: {}, skillSlots: {},
}))
const report = { level: 'Mock / browser visual contract; not real gameplay E2E', verified: false, results: [] }
const luminance = rgb => {
  const values = rgb.match(/\d+/g).slice(0, 3).map(Number).map(value => value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
let browser
const port = process.env.E2E_VISUAL_PORT || '3033'
const web = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort', '--port', port],
  { cwd: path.join(root, 'web'), windowsHide: true, stdio: 'pipe' })
let tail = ''
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', data => { tail += data })
;(async () => {
  try {
    await fs.mkdir(output, { recursive: true })
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert(server.exitCode === null, tail)
      try { if ((await fetch(web)).ok) { ready = true; break } } catch {}
      await delay(200)
    }
    assert(ready, tail)
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(player => {
        window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: window.location.origin }
        localStorage.setItem('gamer_online_current_session', JSON.stringify({
          accessToken: 'online.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.visual', player,
        }))
      }, player)
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url())
        let payload = []
        if (url.pathname.endsWith('/profile')) payload = { player, characters, inventory: [] }
        if (url.pathname.endsWith('/dungeons')) payload = { dungeons: [] }
        if (url.pathname.endsWith('/current')) payload = {
          room_id: 'visual-room', dungeon_id: 'visual-squad', dungeon_type: 'SQUAD', leader_id: player.id,
          status: 'waiting', capacity: 5, max_characters_per_member: 5, character_ids: [],
          members: [{ player_id: player.id, username: player.displayName, character_ids: [], is_ready: false, connection_status: 'online' }],
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
      })
      for (const route of ['characters', 'dungeons/multiplayer']) {
        await page.goto(`${web}/#/${route}`)
        await page.locator('.element-badge').first().waitFor()
        await delay(700)
        const badges = await page.locator('.element-badge').evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
          return { element: node.dataset.element, background: style.backgroundColor, color: style.color,
            childColors: [...node.children].map(child => getComputedStyle(child).color),
            width: rect.width, height: rect.height }
        }))
        assert.equal(new Set(badges.map(row => row.element)).size, 8)
        for (const badge of badges) {
          assert(contrast(badge.background, badge.color) >= 4.5, `${route} ${width} ${badge.element}`)
          assert(badge.childColors.every(color => contrast(badge.background, color) >= 4.5))
        }
        assert.deepEqual(errors, [])
        const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
        assert.equal(horizontalOverflow, false)
        await page.screenshot({ path: path.join(output, `${route.replace('/', '-')}-${width}.png`), fullPage: true })
        report.results.push({ route, width, badges, horizontalOverflow })
      }
      await context.close()
    }
    report.verified = true
  } catch (error) { report.failure = String(error); process.exitCode = 1 }
  finally {
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
    if (browser) await browser.close()
    if (server.exitCode === null) { server.kill(); await once(server, 'exit') }
    console.log(JSON.stringify({ verified: report.verified, level: report.level,
      viewports: report.results.length, failure: report.failure, output }, null, 2))
  }
})()
