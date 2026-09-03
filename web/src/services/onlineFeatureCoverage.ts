export type OnlineCoverage = 'ready' | 'partial' | 'pending'

export const ONLINE_ROUTE_COVERAGE: Record<string, { status: OnlineCoverage; note: string; onlineRoute?: string }> = {
  '/': { status: 'ready', note: '玩家资料、资源栏和提醒使用在线 API。' },
  '/characters': { status: 'partial', note: '角色资料、升级、装备和九槽技能已在线；立绘与战魂仍为原型功能。' },
  '/dungeons': { status: 'partial', note: '单人经验本与扫荡已在线；旧多人房间仍为原型功能。' },
  '/gacha': { status: 'ready', note: '卡池、金币消耗、结果和持久化已在线。' },
  '/crafting': { status: 'ready', note: '材料、专属武器和套装制作已在线。' },
  '/inventory': { status: 'ready', note: '背包、锁定、解锁和分解已在线。' },
  '/online-progress': { status: 'ready', note: '挂机收益与每日目标已在线。' },
  '/shop': { status: 'pending', note: '活动商店尚未迁移出 Python 原型。' },
  '/social': { status: 'pending', note: 'NestJS 好友助战接口已存在，但旧页面尚未切换客户端。' },
  '/world-boss': { status: 'pending', note: '全服 Boss 仍依赖 Python 原型。' },
  '/quests': { status: 'pending', note: '旧任务接口尚未迁入正式后端。' },
  '/achievements': { status: 'pending', note: '成就接口尚未迁入正式后端。' },
  '/enhancement': { status: 'ready', note: '强化预览、强化与突破由服务端计算。' },
  '/admin': { status: 'ready', note: '正式模式使用在线运营后台。', onlineRoute: '/online-admin' },
  '/online-admin': { status: 'ready', note: '在线运营后台使用正式 API。' },
}

export const resolveFormalOnlineRoute = (path: string) => {
  const coverage = ONLINE_ROUTE_COVERAGE[path]
  if (!coverage || coverage.status === 'pending') return null
  return coverage.onlineRoute || path
}
