// Actual React pages with formal HTTP contracts, plus a separate real static adapter session.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('../../server-nest/node_modules/playwright')
const { tmpdir } = require('node:os')
const root = path.resolve(__dirname, '../..')
const port = process.env.IMPLEMENTATION_TEST_PORT || '3047'
const origin = `http://127.0.0.1:${port}`
let output
const results = []
const failures = []
const player = { id: 'implementation-test', displayName: '验收账号', level: 100, gold: 100000 }
let server, browser, serverOutput = ''
const requests = []
let catalog, characters, items
let previewError = false, dungeonError = false, characterError = false
let craftFailure = false, enhancementFailure = false, failReadInventory = false
let inventoryBusinessFailure = false, materialBusinessFailure = false
let enhancedLevel = 0, equipmentPreviewDelay = 0, catalogInvalid = false
const craftRequests = [], enhancementRequests = [], lockRequests = [], dismantleRequests = []
const equipment = () => items.filter(item => item.itemType === 'equipment').map((item, i) => ({
  ...item, payload: { ...item.payload, enhancementLevel: i === 0 ? enhancedLevel : 0 },
}))

async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`) }
}
async function formalContext(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  const errors = []
  const loggedErrors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') loggedErrors.push(message.text())
  })
  page.on('dialog', dialog => dialog.accept())
  await context.addInitScript(player => {
    window.__GAMER_RUNTIME_CONFIG__ = { formalOnline: true, staticDemo: false, apiBase: location.origin }
    localStorage.setItem('gamer_online_current_session', JSON.stringify({
      accessToken: 'online.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.test', player,
    }))
  }, player)
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname
    requests.push({ pathname, method: request.method(), body: request.postData() })
    let data = {}, status = 200
    if (pathname.endsWith('/profile')) {
      if (characterError) { status = 500; data = { success: false, message: '角色加载失败' } }
      else data = { player, characters, inventory: items }
    } else if (pathname === '/api/configs/characters') {
      data = { payload: catalogInvalid ? null : { characters: catalog } }
    } else if (pathname === '/api/dungeons') {
      if (dungeonError) { status = 500; data = { success: false, message: '副本加载失败' } }
      else data = { dungeons: [{ dungeonId: 'water_type_single_001', name: '水属性经验本', dungeonType: 'SINGLE', attributeType: 'WATER', duration: 60 }] }
    } else if (pathname === '/api/dungeons/water_type_single_001') {
      status = dungeonError ? 500 : 200
      data = dungeonError ? { success: false, message: '详情失败' } : { dungeon: { dungeonId: 'water_type_single_001', name: '水属性经验本', dungeonType: 'SINGLE', attributeType: 'WATER', duration: 60 } }
    } else if (pathname.endsWith('/progress')) data = []
    else if (pathname === `/api/inventory/${player.id}`) {
      if (inventoryBusinessFailure) data = { success: false, message: 'SYNTHETIC_PRIVATE_RESPONSE_CANARY', items: [] }
      else if (failReadInventory) { status = 500; data = { message: '库存加载失败' } }
      else data = [...items.filter(row => row.itemType !== 'equipment'), ...equipment()]
    } else if (pathname.endsWith('/materials')) data = { success: true, materials: items.filter(row => ['material', 'fragment', 'consumable'].includes(row.itemType)).map(row => ({
      itemId: row.id, itemConfigId: row.itemConfigId, count: row.quantity,
    })) }
    else if (pathname.endsWith('/crafting/preview')) {
      const input = request.postDataJSON()
      if (input.attributeType === 'FIRE') await delay(300)
      data = { success: !previewError, preview: previewError ? null : {
        costs: [{ materialType: 'EQUIPMENT_SET', attributeType: input.attributeType, required: 1, owned: 17, enough: true }],
        gold: { required: 0, owned: 100000, enough: true }, canCraft: true,
      } }
    } else if (/\/crafting\/(equipment|exclusive)$/.test(pathname)) {
      craftRequests.push({ path: pathname, body: request.postDataJSON(), key: request.headers()['idempotency-key'] })
      await delay(120)
      if (craftFailure) { status = 500; data = { success: false, message: '制作失败' } }
      else data = { success: true, message: '制作成功', item: { id: 'crafted', payload: { name: '验收产物' } } }
    } else if (pathname.endsWith('/enhancement')) {
      await delay(equipmentPreviewDelay)
      data = { success: !previewError, preview: previewError ? null : {
        currentLevel: enhancedLevel, nextLevel: enhancedLevel + 1, maxLevel: 50, successRate: 1,
        costs: { gold: { required: 1000, owned: 100000, enough: true },
          material: { materialType: 'EQUIPMENT_SET', required: 1, owned: 17, enough: true } },
      } }
    } else if (/\/equipment\/.+\/(enhance|breakthrough)$/.test(pathname)) {
      enhancementRequests.push({ path: pathname, key: request.headers()['idempotency-key'] })
      await delay(120)
      if (enhancementFailure) { status = 500; data = { success: false, message: '强化请求失败' } }
      else {
        enhancedLevel++
        data = { success: true, message: '强化完成', equipment: equipment()[0] }
      }
    } else if (pathname.endsWith('/lock') || pathname.endsWith('/unlock')) {
      lockRequests.push(pathname); await delay(150)
      const item = items.find(row => pathname.includes(`/items/${row.id}/`))
      if (item) item.locked = pathname.endsWith('/lock')
      data = item || { success: false }
    } else if (pathname.endsWith('/dismantle-preview')) data = { materials: [{ materialType: 'EQUIPMENT_SET', quantity: 1 }] }
    else if (pathname.endsWith('/dismantle')) {
      dismantleRequests.push(pathname); await delay(150)
      items = items.filter(row => !pathname.includes(`/items/${row.id}/`))
      data = { success: true, materials: [{ materialType: 'EQUIPMENT_SET', quantity: 1 }] }
    } else if (pathname.endsWith('/exp-preview')) data = { canAfford: true, targetLevel: 2, requiredExpPackages: 10, ownedExpPackages: 100, maxLevel: 100 }
    if (pathname.endsWith('/materials') && materialBusinessFailure) {
      data = { success: false, message: 'SYNTHETIC_PRIVATE_RESPONSE_CANARY', materials: [] }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  })
  return { context, page, errors, loggedErrors }
}
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
async function main() {
  output = await fs.mkdtemp(path.join(tmpdir(), 'gamer-01g-browser-'))
  const cache = await fs.mkdtemp(path.join(tmpdir(), 'gamer-01g-implementation-cache-'))
  catalog = JSON.parse((await fs.readFile(path.join(root, 'data/content/characters.json'), 'utf8')).replace(/^\uFEFF/, '')).characters
  characters = [...catalog].reverse().map(c => ({ id: `instance-${c.number}`, characterConfigId: c.id, name: c.name,
    attributeType: c.attributeType, professionType: c.professionType, level: 1, exp: 0,
    equipment: c.number === 1 ? { illustrations: { selected_path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=' } } : {} }))
  items = [
    { id: 'shared', itemConfigId: 'generic_battle_material', itemType: 'material', quantity: 17, payload: { name: '通用战斗材料' } },
    { id: 'exp', itemConfigId: 'character_exp_crystal', itemType: 'material', quantity: 100, payload: { name: '经验结晶' } },
    { id: 'fragment', itemConfigId: 'illustration_piece', itemType: 'fragment', quantity: 3, payload: { name: '立绘碎片' } },
    { id: 'potion', itemConfigId: 'potion', itemType: 'consumable', quantity: 2, payload: { name: '药剂' } },
    { id: 'unknown', itemConfigId: 'future', itemType: 'future', quantity: 1, payload: { name: '未知道具' } },
    { id: 'equip-a', itemConfigId: 'equipment_a', itemType: 'equipment', quantity: 1, payload: { name: '装备甲', enhancementLevel: 0 } },
    { id: 'equip-b', itemConfigId: 'equipment_b', itemType: 'equipment', quantity: 1, payload: { name: '装备乙', enhancementLevel: 0 } },
  ]
  const serverCode = `import('vite').then(async ({createServer}) => {const {default:react}=await import('@vitejs/plugin-react');return createServer({configFile:false,envFile:false,plugins:[react()],cacheDir:${JSON.stringify(cache)},server:{host:'127.0.0.1',port:${Number(port)},strictPort:true}}).then(s=>s.listen())})`
  server = spawn(process.execPath, ['-e', serverCode],
    { cwd: path.join(root, 'web'), windowsHide: true, stdio: 'pipe' })
  for (const pipe of [server.stdout, server.stderr]) pipe.on('data', data => { serverOutput += data })
  let ready = false
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, serverOutput)
    try { if ((await fetch(origin)).ok) { ready = true; break } } catch {}
    await delay(100)
  }
  assert(ready, serverOutput)
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  for (const width of [320, 390, 430, 768, 769, 1024, 1280, 1365]) {
    await check(`character actual DOM numeric order, ${width}px ${width <= 768 ? 4 : 8} columns`, async () => {
      const { context, page, errors } = await formalContext(width)
      try {
        await page.goto(`${origin}/#/characters`)
        await page.locator('.character-card[data-character-number="1"]').waitFor()
        assert.equal(await page.locator('.character-card').count(), 64)
        const geometry = await page.locator('.character-card').evaluateAll(nodes => nodes.map(node => ({
          number: Number(node.dataset.characterNumber), rect: node.getBoundingClientRect().toJSON(),
        })))
        assert.deepEqual(geometry.map(row => row.number), Array.from({ length: 64 }, (_, i) => i + 1))
        const columns = width <= 768 ? 4 : 8
        assert.equal(geometry.filter(row => Math.abs(row.rect.y - geometry[0].rect.y) < 1).length, columns)
        assert.equal(await page.locator('.characters-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), columns)
        await noOverflow(page)
        for (const rect of geometry.map(row => row.rect)) assert(rect.x >= 0 && rect.x + rect.width <= width + 1)
        const overlaps = await page.locator('.character-card').first().evaluate(node => {
          const lock = node.querySelector('.lock-btn').getBoundingClientRect()
          const name = node.querySelector('.character-name').getBoundingClientRect()
          return { width: lock.width, height: lock.height, overlaps: lock.bottom > name.top && lock.top < name.bottom }
        })
        assert(overlaps.width >= 44 && overlaps.height >= 44)
        assert.equal(overlaps.overlaps, false)
        await page.screenshot({ path: path.join(output, `characters-${width}.png`), fullPage: true })
        await page.locator('.filter-select').nth(1).selectOption('DPS')
        const filtered = await page.locator('.character-card').evaluateAll(nodes => nodes.map(node => Number(node.dataset.characterNumber)))
        assert(filtered.length > 0 && filtered.length < 64)
        assert.deepEqual(filtered, [...filtered].sort((a, b) => a - b))
        await page.locator('.character-card').first().focus()
        await page.keyboard.press('Enter')
        await page.locator('.character-detail-modal').waitFor()
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    })
  }
  await check('home entries removed, old routes retained and no hint requests', async () => {
    const { context, page, errors } = await formalContext(390)
    try {
      const start = requests.length
      await page.goto(origin)
      await page.locator('.menu-buttons').waitFor()
      for (const label of ['在线收益', '好友助战', '任务', '制作系统', '背包', '装备强化']) assert.equal(await page.locator('.menu-buttons').getByRole('button', { name: label, exact: true }).count(), 0)
      for (const label of ['角色管理', '副本选择', '角色抽取', '材料']) assert.equal(await page.locator('.menu-buttons').getByRole('button', { name: label, exact: true }).count(), 1)
      assert.equal(requests.slice(start).filter(row => /idle|daily-goals|auth\/guest/.test(row.pathname)).length, 0)
      await page.screenshot({ path: path.join(output, 'home-390.png'), fullPage: true })
      await page.locator('.menu-buttons').getByRole('button', { name: '材料', exact: true }).click()
      await page.locator('.inventory-panel .item-card').first().waitFor()
      await noOverflow(page)
      for (const route of ['inventory', 'crafting', 'enhancement']) {
        await page.goto(`${origin}/#/${route}`)
        await page.locator(`.${route}-panel`).waitFor()
      }
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  })
  await check('materials categories, unknown/consumable retention, details, lazy panels, navigation intent', async () => {
    const { context, page, errors } = await formalContext(390)
    try {
      const start = requests.length
      await page.goto(`${origin}/#/materials`)
      await page.locator('.item-card').first().waitFor()
      assert.equal(await page.locator('.item-card').count(), items.length)
      assert.equal(await page.locator('.item-card').filter({ hasText: '通用战斗材料' }).count(), 1)
      assert.equal(requests.slice(start).filter(row => /\/crafting\/preview|\/enhancement$/.test(row.pathname)).length, 0)
      for (const label of ['突破材料', '经验材料', '装备与强化材料', '角色头像', '立绘碎片']) assert.equal(await page.getByRole('tab', { name: label, exact: true }).count(), 1)
      await page.getByLabel('搜索材料').fill('药剂')
      assert.equal(await page.locator('.item-card').count(), 1)
      await page.locator('.item-card').getByRole('button', { name: '详情' }).click()
      await page.getByRole('dialog', { name: '药剂' }).waitFor()
      await page.getByRole('button', { name: '关闭材料详情' }).click()
      await page.getByLabel('搜索材料').fill('')
      await page.screenshot({ path: path.join(output, 'materials-390.png'), fullPage: true })
      await noOverflow(page)
      await page.getByRole('tab', { name: '突破材料', exact: true }).click()
      await page.locator('.item-card').first().waitFor()
      assert.equal(await page.locator('.item-card').count(), 1)
      await page.getByRole('tab', { name: '经验材料', exact: true }).click()
      await page.locator('.avatar-choice').first().waitFor()
      assert.equal(await page.locator('.item-card').count(), 1)
      await page.locator('.avatar-choice').first().click()
      await page.locator('.character-detail-modal').waitFor()
      await page.locator('.character-detail-modal .close-btn').click()
      await page.reload()
      await page.locator('.character-card').first().waitFor()
      assert.equal(await page.locator('.character-detail-modal').count(), 0)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  })
  await check('formal role locking disabled with handler guard; illustration deep links cannot expose exchange', async () => {
    const { context, page, errors } = await formalContext()
    try {
      const start = requests.length
      await page.goto(`${origin}/#/characters`)
      await page.locator('.character-card').first().waitFor()
      await page.getByText('角色锁定暂未开放', { exact: true }).waitFor()
      const lock = page.locator('.character-card .lock-btn').first()
      assert(await lock.isDisabled())
      await lock.evaluate(button => { button.disabled = false; button.click() })
      // React ignores a disabled button handler even after DOM tampering; its card may receive the click.
      if (await page.locator('.character-detail-modal').count()) await page.locator('.character-detail-modal .close-btn').click()
      assert.equal(await page.locator('.character-card.locked').count(), 0)
      await lock.evaluate(async button => {
        const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))]
        await props.onClick({ stopPropagation() {} })
      })
      await page.locator('.character-card').first().click()
      const modal = page.locator('.character-detail-modal')
      await modal.waitFor()
      assert(await modal.locator('.lock-btn-large').isDisabled())
      await modal.locator('.lock-btn-large').evaluate(button => { button.disabled = false; button.click() })
      await modal.locator('.lock-btn-large').evaluate(async button => {
        const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))]
        await props.onClick()
      })
      assert.equal(await modal.getByRole('button', { name: '立绘', exact: true }).count(), 0)
      assert.equal(await modal.locator('.illustration-section').count(), 1)
      await page.waitForFunction(() => document.querySelector('.illustration-image')?.naturalWidth > 0)
      await modal.getByText('角色锁定暂未开放', { exact: true }).waitFor()
      await modal.locator('.close-btn').click()
      await page.evaluate(id => {
        const state = history.state || {}
        history.replaceState({ ...state, usr: { characterId: id, tab: 'illustration' }, key: 'synthetic-illustration-intent' }, '', location.href)
      }, characters.at(-1).id)
      await page.reload()
      await page.locator('.character-detail-modal').waitFor()
      assert.equal(await page.locator('.illustration-action-btn').count(), 0)
      assert.equal(await page.locator('.character-detail-main').count(), 1)
      assert.equal(requests.slice(start).filter(row => /\/characters\/.+\/(?:un)?lock$|\/exchange\//.test(row.pathname)).length, 0)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  })
  await check('illustration materials remain readable without exchange entry; role avatar navigation retained', async () => {
    const { context, page, errors } = await formalContext(390)
    try {
      const start = requests.length
      await page.goto(`${origin}/#/materials?tab=avatar-fragments`)
      await page.locator('.item-card').first().waitFor()
      assert.equal(await page.locator('.item-card').count(), 1)
      assert.equal(await page.locator('.avatar-choice').count(), 0)
      await page.getByText('立绘兑换暂未开放', { exact: true }).waitFor()
      await page.locator('.item-card').getByRole('button', { name: '详情' }).click()
      await page.getByText('立绘碎片；兑换暂未开放', { exact: true }).waitFor()
      assert.equal(await page.locator('.material-detail footer button').count(), 0)
      await page.getByRole('button', { name: '关闭材料详情' }).click()
      await noOverflow(page)
      await page.getByRole('tab', { name: '角色头像', exact: true }).click()
      await page.locator('.avatar-choice').first().click()
      await page.locator('.character-detail-modal').waitFor()
      assert.equal(await page.locator('.illustration-action-btn').count(), 0)
      assert.equal(requests.slice(start).filter(row => /\/exchange\//.test(row.pathname)).length, 0)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  })
  await check('crafting preview authority/race, six slots including HEAD, double-submit and retry key', async () => {
    const { context, page, errors } = await formalContext()
    try {
      await page.goto(`${origin}/#/materials?tab=crafting`)
      await page.getByRole('button', { name: '套装部件', exact: true }).click()
      await page.getByLabel('制作属性').selectOption('FIRE')
      await page.getByLabel('制作属性').selectOption('WATER')
      await page.getByLabel('制作职业类别').selectOption('A')
      const craft = page.locator('.craft-btn')
      for (const slot of ['HELMET', 'CHEST', 'GLOVES', 'LEGS', 'BOOTS', 'ACCESSORY']) {
        await page.getByLabel('制作部位').selectOption(slot)
        await craft.waitFor()
        await page.waitForFunction(() => !document.querySelector('.craft-btn').disabled)
        const before = craftRequests.length, reads = requests.filter(row => row.pathname.endsWith('/materials')).length
        await craft.evaluate(button => { button.click(); button.click() })
        await page.waitForFunction(() => document.querySelector('.crafted-result'))
        await page.waitForFunction(() => !document.querySelector('.craft-btn').disabled)
        assert.equal(craftRequests.length - before, 1)
        assert.equal(craftRequests.at(-1).body.slot, slot === 'HELMET' ? 'HEAD' : slot)
        assert.equal(craftRequests.at(-1).body.attributeType, 'WATER')
        assert.equal(requests.filter(row => row.pathname.endsWith('/materials')).length - reads, 1, 'only post-operation refresh')
      }
      craftFailure = true
      await craft.click()
      await page.locator('.crafting-feedback.error').waitFor()
      const failedKey = craftRequests.at(-1).key
      craftFailure = false
      await craft.click()
      await page.locator('.crafting-feedback.success').waitFor()
      assert.equal(craftRequests.at(-1).key, failedKey)
      previewError = true
      await page.getByRole('button', { name: '刷新制作预览' }).click()
      await page.locator('.crafting-feedback.error').waitFor()
      assert(await craft.isDisabled())
      assert.deepEqual(errors, [])
    } finally { previewError = false; craftFailure = false; await context.close() }
  })
  await check('enhancement preview required, stale selection, error/retry, double-submit', async () => {
    const { context, page, errors } = await formalContext()
    try {
      previewError = true
      await page.goto(`${origin}/#/materials?tab=enhancement&itemId=equip-a`)
      await page.locator('.enhancement-feedback.error').waitFor()
      assert(await page.locator('.btn-enhance').isDisabled())
      previewError = false
      await page.getByRole('button', { name: '重试预览' }).click()
      await page.waitForFunction(() => !document.querySelector('.btn-enhance').disabled)
      equipmentPreviewDelay = 250
      await page.getByRole('button', { name: '选择装备乙' }).click()
      assert(await page.locator('.btn-enhance').isDisabled())
      await page.getByRole('button', { name: '选择装备甲' }).click()
      await page.waitForFunction(() => !document.querySelector('.btn-enhance').disabled)
      const before = enhancementRequests.length
      enhancementFailure = true
      await page.locator('.btn-enhance').evaluate(button => { button.click(); button.click() })
      await page.locator('.enhancement-feedback.error').waitFor()
      assert.equal(enhancementRequests.length - before, 1)
      const key = enhancementRequests.at(-1).key
      enhancementFailure = false
      await page.locator('.btn-enhance').click()
      await page.locator('.enhancement-feedback.success').waitFor()
      assert.equal(enhancementRequests.at(-1).key, key)
      assert(enhancementRequests.at(-1).path.includes('equip-a'))
      assert.equal(enhancedLevel, 1)
      assert.deepEqual(errors, [])
    } finally { enhancementFailure = false; equipmentPreviewDelay = 0; await context.close() }
  })
  await check('inventory lock/dismantle double-submit guarded and failed inventory visible', async () => {
    const { context, page, errors } = await formalContext()
    try {
      await page.goto(`${origin}/#/materials?tab=equipment`)
      const card = page.locator('.item-card').filter({ hasText: '装备乙' })
      await card.waitFor()
      let before = lockRequests.length
      await card.getByRole('button', { name: '锁定', exact: true }).evaluate(button => { button.click(); button.click() })
      await card.getByRole('button', { name: '解锁', exact: true }).waitFor()
      assert.equal(lockRequests.length - before, 1)
      await card.getByRole('button', { name: '解锁', exact: true }).click()
      await card.getByRole('button', { name: '分解', exact: true }).waitFor()
      before = dismantleRequests.length
      await card.getByRole('button', { name: '分解', exact: true }).evaluate(button => { button.click(); button.click() })
      await page.waitForFunction(() => ![...document.querySelectorAll('.item-card')].some(card => card.textContent.includes('装备乙')))
      assert.equal(dismantleRequests.length - before, 1)
      failReadInventory = true
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await page.locator('.inventory-feedback.error').waitFor()
      assert.deepEqual(errors, [])
    } finally { failReadInventory = false; await context.close() }
  })
  await check('HTTP 200 inventory/material business failures stay visible, retain inventory and recover without private logs', async () => {
    const { context, page, errors, loggedErrors } = await formalContext()
    try {
      await page.goto(`${origin}/#/inventory`)
      await page.locator('.item-card').first().waitFor()
      const before = await page.locator('.item-card').count()
      inventoryBusinessFailure = true
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await page.locator('.inventory-feedback.error').waitFor()
      assert.equal(await page.locator('.item-card').count(), before)
      inventoryBusinessFailure = false
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await page.locator('.inventory-feedback.error').waitFor({ state: 'detached' })
      inventoryBusinessFailure = true
      await page.reload()
      await page.locator('.inventory-feedback.error').waitFor()
      inventoryBusinessFailure = false
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await page.locator('.item-card').first().waitFor()
      materialBusinessFailure = true
      await page.goto(`${origin}/#/crafting`)
      await page.getByText('加载材料失败，请稍后重试', { exact: true }).waitFor()
      materialBusinessFailure = false
      await page.reload()
      await page.locator('.cost-preview').waitFor()
      assert(!loggedErrors.join('\n').includes('SYNTHETIC_PRIVATE_RESPONSE_CANARY'))
      assert(loggedErrors.some(message => message.includes('Gamer operation failed')))
      assert.deepEqual(errors, [])
    } finally {
      inventoryBusinessFailure = false
      materialBusinessFailure = false
      await context.close()
    }
  })
  await check('character/dungeon/detail failures visible, retry and catalog failure retain characters', async () => {
    const { context, page, errors } = await formalContext()
    try {
      characterError = true
      await page.goto(`${origin}/#/characters`)
      await page.getByRole('alert').first().waitFor()
      characterError = false
      catalogInvalid = true
      await page.getByRole('button', { name: '重试', exact: true }).first().click()
      await page.locator('.character-card').first().waitFor()
      assert.equal(await page.locator('.character-card').count(), 64)
      await page.getByText('角色编号目录加载失败，角色仍保留，可重试加载。').waitFor()
      catalogInvalid = false
      dungeonError = true
      await page.goto(`${origin}/#/dungeons`)
      await page.getByRole('alert').first().waitFor()
      dungeonError = false
      await page.getByRole('button', { name: '重试', exact: true }).first().click()
      await page.locator('.dungeon-card').first().waitFor()
      dungeonError = true
      await page.locator('.btn-detail').click()
      await page.getByRole('alert').first().waitFor()
      assert.equal(await page.locator('.dungeon-detail-modal').count(), 0)
      dungeonError = false
      await page.locator('.btn-detail').click()
      await page.locator('.dungeon-detail-modal').waitFor()
      assert.deepEqual(errors, [])
    } finally { characterError = false; dungeonError = false; catalogInvalid = false; await context.close() }
  })
  await check('real static adapter: login, inventory classification, disabled unsupported actions, saved progress retained', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    try {
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await context.addInitScript(() => {
        window.__GAMER_RUNTIME_CONFIG__ = { staticDemo: true, formalOnline: false }
      })
      await page.goto(`${origin}/#/login`)
      await page.locator('input[type="text"]').fill('implementation-demo')
      await page.locator('input[type="password"]').fill('demo-password')
      await page.locator('button[type="submit"]').click()
      await page.locator('.menu-buttons').waitFor()
      const raw = await page.evaluate(() => localStorage.getItem('gamer_static_demo_state'))
      await page.goto(`${origin}/#/materials`)
      await page.getByRole('tab', { name: '经验材料', exact: true }).click()
      await page.locator('.item-card').first().waitFor()
      assert.equal(await page.locator('.item-card').count(), 1)
      assert.match(await page.locator('.item-card').innerText(), /3000/)
      await page.getByRole('tab', { name: '制作', exact: true }).click()
      assert(await page.locator('.craft-btn').isDisabled())
      await page.screenshot({ path: path.join(output, 'static-materials-390.png'), fullPage: true })
      await noOverflow(page)
      await page.getByRole('tab', { name: '强化与突破', exact: true }).click()
      await page.getByText('静态试玩尚未接入装备强化与突破，不会消耗材料。').waitFor()
      await page.getByRole('tab', { name: '立绘碎片', exact: true }).click()
      await page.getByText('立绘兑换暂未开放', { exact: true }).waitFor()
      assert.equal(await page.locator('.avatar-choice').count(), 0)
      const after = await page.evaluate(() => localStorage.getItem('gamer_static_demo_state'))
      assert.equal(after, raw)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  })
}
main().catch(error => { failures.push({ name: 'runner', error: error.stack }); console.error(error) })
  .finally(async () => {
    if (browser) await browser.close()
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited }
    if (output) await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({
      level: 'Real React pages + formal HTTP mock contract; real static adapter separately; not online database E2E or performance evidence',
      results, failures, requests, craftRequests, enhancementRequests, lockRequests, dismantleRequests,
    }, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ passed: results.length, failed: failures.length, output }))
    if (failures.length) process.exitCode = 1
  })
