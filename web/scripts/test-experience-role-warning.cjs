const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { chromium } = require('playwright')

async function main() {
  const storage = new Map()
  const sandbox = { exports: {}, localStorage: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/experienceRoleWarning.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, sandbox)
  const rules = sandbox.exports
  for (const role of ['PHYSICAL_TANK', 'MAGIC_TANK', 'HEALER', 'SUPPORT', '物理坦克', '法系坦克', '治疗', '辅助']) {
    assert.equal(rules.isExperienceSupportRole(role), true)
  }
  for (const role of ['PHYSICAL_MELEE_DPS', 'PHYSICAL_RANGED_DPS', 'MAGIC_MELEE_DPS', 'MAGIC_RANGED_DPS']) {
    assert.equal(rules.isExperienceSupportRole(role), false)
  }
  const today = new Date(2026, 8, 17, 23, 59)
  rules.muteExperienceRoleWarningToday('first', today)
  assert.equal(rules.isExperienceRoleWarningMuted('first', today), true)
  assert.equal(rules.isExperienceRoleWarningMuted('second', today), false)
  assert.equal(rules.isExperienceRoleWarningMuted('first', new Date(2026, 8, 18)), false)
  sandbox.localStorage.getItem = () => { throw new Error('blocked') }
  sandbox.localStorage.setItem = () => { throw new Error('blocked') }
  assert.equal(rules.isExperienceRoleWarningMuted('first'), false)
  assert.doesNotThrow(() => rules.muteExperienceRoleWarningToday('first'))

  const { createServer } = await import('vite')
  const server = await createServer({ root: path.join(__dirname, '..'), server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/#/dungeons`
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' })
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('dialog', dialog => dialog.dismiss())
      let starts = 0
      const player = { id: 'warning-test', displayName: 'Tester', level: 1, gold: 100000 }
      const characters = ['PHYSICAL_TANK', 'MAGIC_TANK', 'HEALER', 'SUPPORT', 'PHYSICAL_MELEE_DPS'].map((role, i) => ({
        id: `hero-${i}`, name: `Hero ${i}`, attributeType: 'WATER', professionType: role, level: 1,
      }))
      await page.addInitScript(player => {
        window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: window.location.origin }
        localStorage.setItem('gamer_online_current_session', JSON.stringify({ accessToken: 'online.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.test', player }))
      }, player)
      await page.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        let payload = {}
        let status = 200
        if (pathname.endsWith('/profile')) payload = { player, characters, inventory: [] }
        if (pathname.endsWith('/dungeons')) payload = { dungeons: [{ dungeonId: 'water_type_single_001', name: 'Test experience', dungeonType: 'SINGLE', attributeType: 'WATER', duration: 60 }] }
        if (pathname.endsWith('/progress')) payload = []
        if (pathname.endsWith('/start')) {
          starts++
          status = 400
          payload = { message: 'Test stops before battle creation' }
        }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
      })
      const open = async () => {
        await page.goto(url)
        await page.locator('.btn-start').first().click()
      }
      const select = async i => {
        const selected = page.locator('.character-select-card.selected')
        if (await selected.count()) await selected.click()
        await page.locator('.character-select-card').nth(i).click()
        await page.locator('.modal-footer .btn-confirm').click()
      }
      await open()
      for (let i = 0; i < 4; i++) {
        await select(i)
        await page.getByRole('dialog').waitFor()
        assert.equal(starts, 0)
        if (i === 0) {
          const bounds = await page.getByRole('dialog').boundingBox()
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
          await page.screenshot({ path: path.join(process.env.TEMP || '.', `experience-warning-${width}.png`) })
        }
        await page.getByRole('button', { name: '否，重新选择' }).click()
      }
      let response = page.waitForResponse(response => response.url().endsWith('/start'))
      await select(4)
      await page.waitForFunction(() => !document.querySelector('dialog'))
      await response
      assert.equal(starts, 1)
      await select(0)
      response = page.waitForResponse(response => response.url().endsWith('/start'))
      await page.getByRole('button', { name: '是，继续进入' }).click()
      await response
      assert.equal(starts, 2)
      await select(0)
      await page.getByLabel('当天不再弹出本提示').check()
      await page.getByRole('button', { name: '否，重新选择' }).click()
      assert.equal(starts, 2)
      await page.reload()
      await page.locator('.btn-start').first().click()
      response = page.waitForResponse(response => response.url().endsWith('/start'))
      await select(2)
      await response
      assert.equal(starts, 3)
      assert.equal(await page.getByRole('dialog').count(), 0)
      await page.evaluate(() => localStorage.setItem('gamer:experience-role-warning:warning-test', '2000-1-1'))
      await select(3)
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(starts, 3)
      assert.deepEqual(errors, [])
      console.log(`PASS width=${width}: role filters, cancel, proceed, daily mute, reload, expiry, Escape`)
      await context.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
