const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const path = require('node:path')
async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      const page = await context.newPage()
      let ready = false, unavailable = false, settlements = []
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => {
        window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: window.location.origin }
        localStorage.setItem('gamer_online_current_session', JSON.stringify({
          accessToken: 'online.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.test',
          player: { id: 'player', displayName: 'Tester', level: 1, gold: 100 },
        }))
        sessionStorage.setItem('gamer_battle_player', JSON.stringify({
          online_mode: true, player_id: 'player', dungeon_id: 'test', settlement_key: 'test-seed',
          dungeon: { duration: 60 }, characters: [{ character_id: 'hero' }],
        }))
      })
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url())
        let payload = {}
        let status = 200
        if (url.pathname.includes('/battles/')) {
          if (unavailable) return route.abort()
          payload = {
            ready, speed: 4,
            frame: { time: ready ? 17 : 12, units: [
              ['hero', ready ? 0 : 75, 10, 0, false, '测试角色', 100, []],
              ['boss', 35, 12, 1, true, '测试首领', 200, ['阶段技能'], true, true],
              ['dead', 0, 0, 0, false, '已死小怪', 50, []],
            ] },
            units: { hero: { isPlayer: true }, boss: { isPlayer: false }, dead: { isPlayer: false } },
            events: [{ time: 10, event_type: 'boss_mechanic', message: '阶段转换' }],
            outcome: ready ? { success: false, duration: 17, damageScore: 65 } : null,
          }
        } else if (url.pathname === '/api/battle-settlement') {
          settlements.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
          if (settlements.length === 1) { status = 503; payload = { message: 'Retry settlement' } }
          else payload = {
            record: { id: 'record', duration: 17, success: false }, outcome: 'failed',
            serverRewards: { expCrystals: 79 }, rewards: [],
            progress: { successfulAttempts: 0, totalAttempts: 1 },
          }
        }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
      })
      await page.goto('http://127.0.0.1:3017/#/battle')
      await page.getByRole('heading', { name: '测试角色', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '1x', exact: true }).isDisabled(), true)
      assert.equal(await page.getByText('已死小怪', { exact: true }).count(), 0)
      assert.equal(await page.getByText('共血', { exact: true }).count(), 1)
      assert.equal(settlements.length, 0)
      unavailable = true
      await page.waitForTimeout(2300)
      assert.equal(await page.getByRole('heading', { name: '测试角色', exact: true }).count(), 1)
      unavailable = false
      await page.reload()
      await page.getByRole('heading', { name: '测试角色', exact: true }).waitFor()
      await page.screenshot({ path: path.join(process.env.TEMP, 'gamer-replay-' + width + '.png'), fullPage: true })
      await page.getByRole('heading', { name: '测试首领', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(process.env.TEMP, 'gamer-replay-units-' + width + '.png'), fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
      ready = true
      await page.waitForFunction(() => document.body.innerText.includes('战斗已结算'), { timeout: 12000 })
      assert.match(await page.locator('body').innerText(), /结果:\s*失败/)
      assert.equal(settlements.length, 2)
      assert.deepEqual(settlements[0], settlements[1])
      assert.deepEqual(settlements[0].body.characterIds, ['hero'])
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(JSON.stringify({ width, refresh: true, reconnect: true, settlementRetry: true, pageErrors: errors.length }))
      await context.close()
    }
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
