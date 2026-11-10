const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const path = require('node:path')
const { chromium } = require('../../server-nest/node_modules/playwright')
const origin = 'http://127.0.0.1:3065'
const player = { id: 'ui-player', displayName: '测试玩家', level: 20, gold: 10000 }
const characters = [1, 2].map(number => ({
  id: `owned-${number}`, characterConfigId: number === 1 ? 'char_001_water_physical_tank' : 'char_002_water_magic_tank',
  number, name: number === 1 ? '江无尘' : '默渊', attributeType: 'WATER', professionType: 'PHYSICAL_TANK',
  level: 1, star: 1, equipment: {},
}))
let server, browser
async function main() {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3065', '--strictPort'],
    { cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'pipe' })
  for (let i = 0; i < 80; i++) { try { if ((await fetch(origin)).ok) break } catch {} await delay(100) }
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(player => {
      window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: location.origin }
      localStorage.setItem('gamer_online_current_session', JSON.stringify({ accessToken: `online.${btoa(JSON.stringify({ exp: 9999999999 }))}.test`, player }))
      localStorage.setItem('gamer_new_player_guide_v2:' + player.id, JSON.stringify({
        completed: ['draw_character', 'learn_dungeons', 'run_exp_dungeon', 'level_character', 'learn_elements'], hidden: false,
      }))
    }, player)
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname
      let data = {}
      if (p.endsWith('/profile')) data = { player, characters, inventory: [] }
      else if (p === '/api/configs/characters') data = { payload: { characters: characters.map(row => ({ id: row.characterConfigId, number: row.number, name: row.name })) } }
      else if (p === '/api/dungeons') data = { dungeons: [{ dungeonId: 'water_type_single_001', dungeonType: 'SINGLE', name: '水经验本', attributeType: 'WATER', duration: 60 }] }
      else if (p.endsWith('/progress') || p === '/api/gacha/pools' || p.includes('/inventory/')) data = []
      else if (p.endsWith('/star-preview')) data = { star: 1, required: 5, owned: 5, multiplier: 1, canUpgrade: true }
      else if (p.endsWith('/star-up')) data = { success: true, character: { ...characters[0], star: 2, equipment: { star: 2 } } }
      else if (p.endsWith('/equipment-options')) data = { weapons: [], equipment: [] }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    })
    let reference
    for (const route of ['dungeons', 'characters', 'gacha', 'materials', 'inventory', 'crafting', 'enhancement', 'social', 'quests', 'achievements', 'shop']) {
      await page.goto(origin + '/#/' + route)
      await page.locator('.game-page-heading').waitFor()
      await page.getByRole('button', { name: '新手指引 5/5' }).waitFor()
      assert.equal(await page.locator('.new-player-guide').count(), 0)
      if (route === 'dungeons') {
        await page.getByRole('button', { name: '新手指引 5/5' }).click()
        await page.locator('.new-player-guide').waitFor()
        await page.getByRole('button', { name: '收起指引', exact: true }).click()
      }
      const layout = await page.locator('.game-frame').evaluate(node => {
        const r = node.getBoundingClientRect()
        const title = node.querySelector('.game-page-heading h1').getBoundingClientRect()
        const guide = node.querySelector('.new-player-guide-tab').getBoundingClientRect()
        const season = node.querySelector('.season-tabs')?.getBoundingClientRect()
        return { x: r.x, width: r.width, center: title.x + title.width / 2, titleTop: title.top, guideBottom: guide.bottom, seasonTop: season?.top }
      })
      reference ||= layout
      assert.equal(layout.width, reference.width, route + ' width')
      assert(Math.abs(layout.center - (layout.x + layout.width / 2)) < 2, route + ' centered title')
      if (width < 768) assert(layout.titleTop >= 62, 'title under resource bar')
      if (layout.seasonTop !== undefined) assert(layout.seasonTop >= layout.guideBottom, 'guide precedes season')
      const overflow = await page.locator('.game-frame').evaluate(node => node.scrollWidth > node.clientWidth + 1)
      assert(!overflow, route + ' horizontal overflow')
      if (route === 'characters') {
        await page.locator('.character-card').first().waitFor()
        assert.equal(await page.locator('.character-card').first().locator('.loadout-slot').count(), 8)
        const sizes = await page.locator('.character-loadout').first().evaluate(node => {
          const w = selector => node.querySelector(selector).getBoundingClientRect().width
          return [w('.loadout-portrait'), w('.loadout-exclusive'), w('.loadout-slot')]
        })
        assert(Math.abs(sizes[0] / sizes[1] - 2) < .05)
        assert(Math.abs(sizes[1] / sizes[2] - 2) < .3)
        await page.getByRole('button', { name: '查看江无尘', exact: true }).click()
        await page.getByRole('button', { name: '背景故事', exact: true }).click()
        await page.getByText('那年春汛', { exact: false }).waitFor()
        await page.getByRole('button', { name: '装备', exact: true }).click()
        assert.equal(await page.locator('.equipment-slot-card').count(), 8)
        await page.screenshot({ path: path.resolve(__dirname, `../../artifacts/unified-equipment-${width}.png`) })
        await page.getByRole('button', { name: '基本信息', exact: true }).click()
        await page.getByRole('button', { name: '升至2星（5碎片）' }).click()
        await page.getByText('升星成功', { exact: true }).waitFor()
        await page.getByRole('button', { name: '关闭角色详情' }).click()
        await page.locator('.character-card').first().waitFor()
        await page.locator('.app').evaluate(node => node.scrollTo(0, 9999))
        await page.getByRole('button', { name: '返回顶部', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.app').scrollTop < 3)
        await page.screenshot({ path: path.resolve(__dirname, `../../artifacts/unified-characters-${width}.png`) })
      }
    }
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${width}px: eleven page widths, centered heading, folded guide, seasons, eight slots, story, top button`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  await browser?.close()
  if (server && server.exitCode === null) { server.kill(); await once(server, 'exit') }
})
