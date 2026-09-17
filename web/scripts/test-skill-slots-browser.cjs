const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const path = require('node:path')

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      let slots = { low: ['A','A','A','A','A'], mid: ['B','B','C'], high: ['C'] }
      const player = { id: 'player', displayName: 'Tester', level: 1, gold: 100 }
      const character = { id: 'hero', name: '配置测试', attributeType: 'WATER', professionType: 'PHYSICAL_DPS', level: 1, equipment: {} }
      await page.addInitScript(player => {
        window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: window.location.origin }
        localStorage.setItem('gamer_online_current_session', JSON.stringify({ accessToken: 'online.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.test', player }))
      }, player)
      await page.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        let payload = {}
        if (pathname.endsWith('/profile')) payload = { player, characters: [character], inventory: [] }
        if (pathname.endsWith('/skills')) {
          if (route.request().method() === 'POST') slots = route.request().postDataJSON().skillSlots
          payload = { success: true, message: '技能配置已保存', skillSlots: slots, unlockedSkills: ['A','B','C'].map((logic, i) => ({ skillId: logic, name: `测试技能${i+1}`, logic, tier: ['LOW','MID','HIGH'][i], description: '测试', targetType: 'SINGLE' })) }
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
      })
      const openSkills = async () => {
        await page.goto('http://127.0.0.1:3017/#/characters')
        await page.locator('.character-card').first().click()
        await page.locator('.tab-btn').filter({ hasText: '技能' }).click()
        await page.getByLabel('槽位分配').waitFor()
        await page.getByText('正式在线技能配置已加载，9 个技能槽从 1 级起开放。', { exact: true }).waitFor()
      }
      await openSkills()
      await page.getByLabel('槽位分配').selectOption('3/3/3')
      for (const [tier, ids] of Object.entries({ '底级别技能': ['A','A','A'], '中级别技能': ['A','A','B'], '高级别技能': ['C','C','C'] })) {
        for (let i = 0; i < ids.length; i++) await page.getByLabel(`${tier}第${i+1}槽`, { exact: true }).selectOption(ids[i])
      }
      await page.getByRole('button', { name: '保存技能配置', exact: true }).click()
      await page.getByText('技能配置已保存', { exact: true }).waitFor()
      assert.deepEqual(slots, { low: ['A','A','A'], mid: ['A','A','B'], high: ['C','C','C'] })
      await page.reload()
      await openSkills()
      assert.equal(await page.getByLabel('槽位分配').inputValue(), '3/3/3')
      assert.equal(await page.locator('.skill-slot-group select').count(), 9)
      await page.screenshot({ path: path.join(process.env.TEMP, `gamer-skills-${width}.png`) })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ width, duplicateSlots: true, reload: true }))
      await context.close()
    }
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
