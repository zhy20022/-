export type NewPlayerGuideStep =
  | 'draw_character'
  | 'learn_dungeons'
  | 'run_exp_dungeon'
  | 'level_character'
  | 'learn_elements'

export interface NewPlayerGuideState {
  completed: NewPlayerGuideStep[]
  hidden: boolean
}

export const newPlayerGuideSteps: Array<{
  id: NewPlayerGuideStep
  title: string
  summary: string
}> = [
  {
    id: 'draw_character',
    title: '先抽取角色',
    summary: '进入角色池完成一次抽取，拿到你的第一批可培养角色。'
  },
  {
    id: 'learn_dungeons',
    title: '了解副本类型',
    summary: '经验副本用于升级，五人本偏材料和装备成长，20人团本偏团队压力、Boss机制和高阶奖励。'
  },
  {
    id: 'run_exp_dungeon',
    title: '挑战对应属性经验本',
    summary: '选择刚抽到的角色，优先进入同属性经验副本，获得通用经验结晶。'
  },
  {
    id: 'level_character',
    title: '给角色升级',
    summary: '回到角色管理页，打开角色详情，用经验结晶手动提升等级。'
  },
  {
    id: 'learn_elements',
    title: '理解属性克制',
    summary: '风克火、火克木、木克风；雷克水、水克土、土克雷；光暗互克。'
  }
]

const guideKey = 'gamer_new_player_guide_v1'
const guideEventName = 'gamer:new-player-guide'

const defaultGuideState: NewPlayerGuideState = {
  completed: [],
  hidden: false
}

export const getNewPlayerGuideState = (): NewPlayerGuideState => {
  try {
    const cached = localStorage.getItem(guideKey)
    if (!cached) return defaultGuideState
    const parsed = JSON.parse(cached) as Partial<NewPlayerGuideState>
    return {
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter((step): step is NewPlayerGuideStep =>
          newPlayerGuideSteps.some((item) => item.id === step)
        )
        : [],
      hidden: Boolean(parsed.hidden)
    }
  } catch {
    return defaultGuideState
  }
}

export const setNewPlayerGuideState = (state: NewPlayerGuideState) => {
  localStorage.setItem(guideKey, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent(guideEventName))
}

export const completeNewPlayerGuideStep = (step: NewPlayerGuideStep) => {
  const current = getNewPlayerGuideState()
  if (current.completed.includes(step)) return current
  const next = {
    ...current,
    hidden: false,
    completed: [...current.completed, step]
  }
  setNewPlayerGuideState(next)
  return next
}

export const setNewPlayerGuideHidden = (hidden: boolean) => {
  const current = getNewPlayerGuideState()
  const next = { ...current, hidden }
  setNewPlayerGuideState(next)
  return next
}

export const resetNewPlayerGuide = () => {
  setNewPlayerGuideState(defaultGuideState)
}

export const getGuideEventName = () => guideEventName
