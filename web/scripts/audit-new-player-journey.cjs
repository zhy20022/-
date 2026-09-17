const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

async function main() {
  const root = path.resolve(__dirname, '../..')
  const database = process.env.E2E_DATABASE_URL
  assert(database && new URL(database).hostname === '127.0.0.1' && new URL(database).pathname.includes('newplayer'))
  const api = 'http://127.0.0.1:4198/api'
  const backend = spawn(process.execPath, ['dist/main.js'], { cwd: path.join(root, 'server-nest'), windowsHide: true, stdio: 'pipe', env: {
    ...process.env, NODE_ENV: 'test', PORT: '4198', DATABASE_URL: database, DB_SSL: 'false', TYPEORM_SYNCHRONIZE: 'true',
    REDIS_URL: 'redis://127.0.0.1:6399', CONTENT_DIR: '../data/content', BACKUP_ENABLED: 'false', AUTH_TOKEN_SECRET: randomUUID() + randomUUID(),
  } })
  let tail = '', server, browser
  backend.stdout.on('data', data => { tail = (tail + data).slice(-1500) })
  backend.stderr.on('data', data => { tail = (tail + data).slice(-1500) })
  const report = { checkedAt: new Date().toISOString(), method: 'mobile browser, real local Nest and PostgreSQL, natural draws, no injected resources or accelerated server clock', draws: [], battles: [], errors: [] }
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(api + '/dungeons')).ok) break } catch {}
      await delay(500)
    }
    assert((await fetch(api + '/dungeons')).ok, tail)
    const { createServer } = await import('vite')
    server = await createServer({ root: path.join(root, 'web'), server: { host: '127.0.0.1', port: 0 } })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    browser = await chromium.launch({ headless: true, channel: 'msedge' })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('dialog', async dialog => { report.errors.push(dialog.message()); await dialog.dismiss() })
    await page.addInitScript(() => {
      window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: 'http://127.0.0.1:4198', socketUrl: 'http://127.0.0.1:4198' }
    })
    const username = 'journey_' + randomUUID().replaceAll('-', '').slice(0, 12)
    const password = randomUUID()
    await page.goto(origin + '/#/register')
    await page.locator('input[type=text]').fill(username)
    await page.locator('input[type=password]').fill(password)
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await page.getByRole('button', { name: '前往角色池', exact: true }).click()
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('gamer_online_current_session')))
    const profile = async () => (await fetch(`${api}/players/${session.player.id}/profile`, { headers: { authorization: `Bearer ${session.accessToken}` } })).json()
    let roster
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = page.waitForResponse(r => r.url().endsWith('/draw') && r.request().method() === 'POST')
      await page.locator('.pull-buttons button').nth(attempt === 0 ? 0 : 1).click()
      const draw = await (await response).json()
      report.draws.push({ count: draw.count, cost: draw.cost, results: draw.results.map(r => ({ name: r.name, profession: r.professionType, duplicate: r.duplicate })) })
      await page.getByRole('button', { name: '查看副本', exact: true }).waitFor()
      const names = JSON.parse(fs.readFileSync(path.join(root, 'data/content/characters.json'), 'utf8').replace(/^\uFEFF/, '')).characters
      roster = (await profile()).characters.map(c => ({ ...c, name: c.name || names.find(n => n.id === c.characterConfigId)?.name }))
      if (roster.some(c => c.professionType.includes('DPS')) && roster.some(c => !c.professionType.includes('DPS'))) break
    }
    const output = roster.find(c => c.professionType.includes('DPS'))
    const teammate = roster.find(c => !c.professionType.includes('DPS'))
    assert(output && teammate, 'No output/teammate pair after 31 natural draws')
    report.output = { name: output.name, configId: output.characterConfigId, attribute: output.attributeType }
    report.teammate = { name: teammate.name, configId: teammate.characterConfigId, attribute: teammate.attributeType, levelBefore: teammate.level }
    await page.screenshot({ path: path.join(process.env.TEMP, 'journey-draw.png'), fullPage: true })
    assert(!/PHYSICAL_|MAGIC_|HEALER|SUPPORT/.test(await page.locator('.result-grid').innerText()))
    assert(!(await page.locator('body').innerText()).includes('经验包'))
    await page.getByRole('button', { name: '查看副本', exact: true }).click()
    await page.getByRole('button', { name: '我已了解副本类型', exact: true }).click()
    const catalog = (await (await fetch(api + '/dungeons')).json()).dungeons
    const dungeon = catalog.find(d => d.dungeonType === 'SINGLE' && d.difficulty === 'normal' && d.attributeType === output.attributeType)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!page.url().endsWith('/dungeons')) await page.goto(origin + '/#/dungeons')
      const card = page.locator('.dungeon-card').filter({ has: page.getByText(dungeon.name, { exact: true }) }).first()
      await card.locator('.btn-start').click()
      const selected = page.locator('.character-select-card').filter({ has: page.getByText(output.name, { exact: true }) })
      await selected.click()
      const settled = page.waitForResponse(r => new URL(r.url()).pathname === '/api/battle-settlement' && r.request().method() === 'POST', { timeout: 120000 })
      await page.locator('.modal-footer .btn-confirm').click()
      const response = await settled
      const settlement = await response.json()
      assert(response.ok(), JSON.stringify(settlement))
      report.battles.push({ success: settlement.record.success, rewards: settlement.serverRewards })
      await page.screenshot({ path: path.join(process.env.TEMP, `journey-settlement-${attempt}.png`), fullPage: true })
      const preview = await (await fetch(`${api}/players/${session.player.id}/characters/${teammate.id}/exp-preview?levelDelta=1`, { headers: { authorization: `Bearer ${session.accessToken}` } })).json()
      if (preview.canAfford) break
    }
    await page.goto(origin + '/#/dungeons')
    await page.getByRole('button', { name: '去角色管理', exact: true }).click()
    await page.locator('.character-card').filter({ has: page.getByText(teammate.name, { exact: true }) }).click()
    const before = await profile()
    await page.getByText(/需要经验结晶 103，金币 103/).waitFor()
    await page.screenshot({ path: path.join(process.env.TEMP, 'journey-upgrade.png'), fullPage: true })
    assert(!(await page.locator('body').innerText()).includes('经验包'))
    const upgraded = page.waitForResponse(r => r.url().endsWith('/use-exp') && r.request().method() === 'POST')
    await page.locator('.growth-panel').getByRole('button', { name: '升级', exact: true }).click()
    const upgrade = await (await upgraded).json()
    const after = await profile()
    const quantity = p => Number(p.inventory.find(i => i.itemConfigId === 'character_exp_crystal')?.quantity || 0)
    assert.equal(after.characters.find(c => c.id === teammate.id).level, 2)
    assert.equal(quantity(before) - quantity(after), upgrade.consumedExpPackages)
    assert.equal(before.player.gold - after.player.gold, upgrade.consumedGold)
    assert.equal(after.characters.find(c => c.id === output.id).level, output.level)
    report.upgrade = { levelAfter: 2, packagesConsumed: upgrade.consumedExpPackages, goldConsumed: upgrade.consumedGold, unplayedTeammate: true }
    const loginResponse = await fetch(api + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    const login = await loginResponse.json()
    const restored = await (await fetch(`${api}/players/${session.player.id}/profile`, { headers: { authorization: `Bearer ${login.accessToken}` } })).json()
    assert.equal(restored.characters.find(c => c.id === teammate.id).level, 2)
    assert.equal(restored.player.gold, after.player.gold)
    assert.equal(quantity(restored), quantity(after))
    report.reloginVerified = true
    report.chineseProfessionLabels = true
    report.crystalNaming = true
    report.guideState = await page.evaluate(id => JSON.parse(localStorage.getItem(`gamer_new_player_guide_v2:${id}`)), session.player.id)
    assert(report.guideState.completed.includes('level_character'))
    report.passed = true
  } catch (error) {
    report.failure = error.message
    throw error
  } finally {
    fs.writeFileSync(path.join(root, 'docs/new-player-journey-2026-09-17.json'), JSON.stringify(report, null, 2))
    await browser?.close()
    await server?.close()
    if (backend.exitCode === null) { backend.kill(); await once(backend, 'exit') }
    console.log(JSON.stringify(report, null, 2))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
