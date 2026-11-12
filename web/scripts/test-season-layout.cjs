const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const path = require('node:path')
const { chromium } = require('../../server-nest/node_modules/playwright')

const origin = 'http://127.0.0.1:3063'
const player = { id: 'season-test', displayName: '界面验收', level: 20, gold: 10000 }
const characters = [10, 2, 1].map(number => ({
  id: `owned-${number}`, characterConfigId: `test-${number}`, number, name: `角色${number}`,
  attributeType: number === 10 ? 'FIRE' : 'WATER', professionType: number === 2 ? 'HEALER' : 'PHYSICAL_MELEE_DPS',
  level: number * 2, star: 3, equipment: { star: 3 },
  stats: { hp: 2345, attack: 180, defense: 99, magic_attack: 40, magic_defense: 80 },
}))
const dungeons = ['normal', 'hard', 'nightmare'].map((difficulty, index) => ({
  dungeonId: `water-${difficulty}`, name: `水经验${difficulty}`, dungeonType: 'SINGLE',
  attributeType: 'WATER', difficulty, recommendedLevel: index * 20 + 1,
  rewardConfig: { type: 'experience', fullExp: 531 }, duration: 60,
}))
let server, browser

async function main() {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3063', '--strictPort'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'pipe',
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch {}
    if (server.exitCode !== null) throw new Error('Test server exited')
    await delay(100)
  }
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(player => {
      window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: location.origin }
      localStorage.setItem('gamer_online_current_session', JSON.stringify({
        accessToken: `online.${btoa(JSON.stringify({ exp: 9999999999 }))}.test`, player,
      }))
      sessionStorage.setItem(`gamer_battle_${player.id}`, JSON.stringify({
        online_mode: true, player_id: player.id, dungeon_id: 'water-normal',
        settlement_key: 'first-battle', character_ids: ['owned-1'],
        characters: [{ character_id: 'owned-1' }], dungeon: { duration: 60 },
      }))
    }, player)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      let data = {}
      if (pathname.includes('/battles/')) data = {
        ready: true, speed: 4, frame: { time: 60, units: [['owned-1', 100, 0, 0, false, '角色1', 100, []]] },
        units: { 'owned-1': { isPlayer: true } }, events: [],
        outcome: { success: true, duration: 60, damageScore: 100 },
      }
      else if (pathname === '/api/battle-settlement') data = {
        record: { id: 'result', success: true, duration: 60 }, rewards: [],
        progress: { successfulAttempts: 10, totalAttempts: 10, bestRecord: { flawlessCount: 10 } },
      }
      else if (pathname.endsWith('/start')) data = { battleSeed: 'second-battle' }
      else if (pathname.endsWith('/profile')) data = { player, characters, inventory: [] }
      else if (pathname === '/api/configs/characters') data = { payload: { characters: characters.map(row => ({ id: row.characterConfigId, number: row.number })) } }
      else if (pathname === '/api/dungeons') data = { dungeons }
      else if (pathname.endsWith('/progress')) data = []
      else if (pathname.includes('/inventory/')) data = []
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(origin)
    await page.getByRole('button', { name: '背包', exact: true }).first().waitFor()
    await page.goto(`${origin}/#/characters`)
    await page.locator('.character-card').first().waitFor()
    assert.equal(await page.locator('.character-card').count(), 3)
    const cards = await page.locator('.character-card').evaluateAll(rows => rows.map(row => {
      const rect = row.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, text: row.innerText }
    }))
    assert.equal(cards[0].y, cards[1].y)
    assert(cards[1].x > cards[0].x)
    assert.match(cards[0].text, /角色1/)
    await page.getByRole('tab', { name: '第二赛季', exact: true }).click()
    await page.getByText('尚未开启', { exact: true }).waitFor()
    assert.equal(await page.locator('.character-card').count(), 0)
    await page.getByRole('tab', { name: '灾厄初启', exact: true }).click()
    await page.locator('.character-card').first().waitFor()
    await page.locator('.character-card').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.resolve(__dirname, `../../artifacts/season-characters-${width}.png`) })
    await page.goto(`${origin}/#/dungeons`)
    await page.locator('.dungeon-card').waitFor()
    assert.equal(await page.locator('.dungeon-card').count(), 1)
    await page.getByRole('button', { name: '开始挑战', exact: true }).click()
    await page.getByRole('dialog', { name: '选择副本难度' }).waitFor()
    assert.equal(await page.locator('.difficulty-option').count(), 3)
    assert.match(await page.locator('.difficulty-option').first().innerText(), /推荐等级/)
    await page.locator('.difficulty-option').first().click()
    await page.locator('.character-select-card').first().waitFor()
    const roster = page.locator('.character-select-card')
    assert.equal(await roster.first().locator('.roster-gear-slot').count(), 8)
    assert.equal(await roster.first().locator('.roster-stats dd').count(), 5)
    assert.match(await roster.first().locator('.roster-stats').innerText(), /2,345/)
    assert.equal(await roster.first().locator('.roster-stars').getAttribute('aria-label'), '角色3星')
    const backgrounds = await roster.evaluateAll(rows => rows.map(row => getComputedStyle(row).backgroundColor))
    assert.notEqual(backgrounds[0], backgrounds[2])
    await roster.first().click()
    assert.equal(await roster.first().getAttribute('aria-pressed'), 'true')
    assert.equal(await roster.first().evaluate(row => getComputedStyle(row).backgroundColor), backgrounds[0])
    assert(await page.locator('.dungeon-roster-modal').evaluate(row => row.scrollWidth <= row.clientWidth + 1))
    await page.getByLabel('角色类型筛选').selectOption('MAGIC')
    assert.equal(await page.locator('.character-select-card').count(), 1)
    assert.match(await page.locator('.character-select-card').innerText(), /角色2/)
    await page.getByLabel('角色类型筛选').selectOption('ALL')
    await page.getByLabel('角色等级排序').selectOption('level-desc')
    assert.match(await page.locator('.character-select-card').first().innerText(), /角色10/)
    await page.screenshot({ path: path.resolve(__dirname, `../../artifacts/season-selection-${width}.png`), fullPage: true })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.goto(`${origin}/#/battle`)
    await page.getByRole('button', { name: '再次战斗', exact: true }).waitFor()
    await delay(5500)
    assert(page.url().endsWith('/#/battle'))
    await page.getByRole('button', { name: '再次战斗', exact: true }).click()
    await page.getByRole('button', { name: '再次战斗', exact: true }).waitFor()
    await page.getByRole('button', { name: '返回副本选择界面', exact: true }).click()
    await page.locator('.dungeon-card').waitFor()
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: backpack, seasons, two columns, numbering, difficulty, filters, no auto-return, rematch`)
    await context.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (browser) await browser.close()
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit')
    server.kill()
    await exited
  }
})
