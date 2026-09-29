export type OnlineCoverage = 'ready' | 'partial' | 'pending'

export const ONLINE_ROUTE_COVERAGE: Record<string, { status: OnlineCoverage; note: string; onlineRoute?: string }> = {
  '/': { status: 'ready', note: '玩家资料、资源栏和提醒使用在线 API。' },
  '/characters': { status: 'partial', note: '角色资料、升级、装备和九槽技能已在线；立绘与战魂仍为原型功能。' },
  '/dungeons': { status: 'partial', note: '单人经验本与扫荡已在线；旧多人房间仍为原型功能。' },
  '/gacha': { status: 'ready', note: '卡池、金币消耗、结果和持久化已在线。' },
  '/crafting': { status: 'ready', note: '材料、专属武器和套装制作已在线。' },
  '/inventory': { status: 'ready', note: '背包、锁定、解锁和分解已在线。' },
  '/online-progress': { status: 'ready', note: '挂机收益与每日目标已在线。' },
  '/shop': { status: 'partial', note: '在线兑换和材料查询已接入；活动轮换与正式商品配置仍待补齐。' },
  '/social': { status: 'partial', note: '好友关系和助战开关已接入；好友角色展示及跨战斗助战尚未完成。' },
  '/world-boss': { status: 'partial', note: '在线状态、服务端战斗伤害、排名和宝箱已接入；赛季生命周期维护仍待补齐。' },
  '/quests': { status: 'partial', note: '任务状态和奖励已接入；每日/每周周期重置及更多目标类型仍待补齐。' },
  '/achievements': { status: 'partial', note: '成就进度与奖励已接入；更多成就定义和并发领取测试仍待补齐。' },
  '/enhancement': { status: 'ready', note: '强化预览、强化与突破由服务端计算。' },
  '/admin': { status: 'ready', note: '正式模式使用在线运营后台。', onlineRoute: '/online-admin' },
  '/online-admin': { status: 'ready', note: '在线运营后台使用正式 API。' },
}

export const resolveFormalOnlineRoute = (path: string) => {
  const coverage = ONLINE_ROUTE_COVERAGE[path]
  if (!coverage || coverage.status === 'pending') return null
  return coverage.onlineRoute || path
}
