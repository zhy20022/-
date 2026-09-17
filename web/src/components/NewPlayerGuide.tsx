import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import {
  NewPlayerGuideStep,
  completeNewPlayerGuideStep,
  getGuideEventName,
  getNewPlayerGuideState,
  newPlayerGuideSteps,
  resetNewPlayerGuide,
  setNewPlayerGuideHidden
} from '../services/newPlayerGuide'
import './NewPlayerGuide.css'

type GuidePage = 'home' | 'gacha' | 'dungeons' | 'characters' | 'battle'

interface NewPlayerGuideProps {
  page: GuidePage
  ownedCharacterCount?: number
  selectedCharacterAttribute?: string
}

const attributeNames: Record<string, string> = {
  WATER: '水',
  EARTH: '土',
  THUNDER: '雷',
  WIND: '风',
  FIRE: '火',
  WOOD: '木',
  LIGHT: '光',
  DARK: '暗'
}

const pageTipMap: Record<GuidePage, string> = {
  home: '按顺序完成这些步骤，就能跑通“抽角色 -> 打经验本 -> 升级 -> 理解副本目标”的第一段新手体验。',
  gacha: '这里是角色池。完成任意一次抽取后，下一步会引导你去看副本。',
  dungeons: '新手优先用输出职业挑战同属性1人经验本。坦克、治疗和辅助可使用输出角色获得的经验结晶升级，不必亲自刷本。',
  characters: '经验结晶由账号内角色共用，不限制属性或职业。在角色详情中消耗经验结晶和金币，即可为未满级角色升级。',
  battle: '经验本需在60秒限时内清怪才算通关，仅坚持到结束不算通关。结算获得的经验结晶由账号内所有角色共用，可留给坦克、治疗或辅助升级。'
}

const getNextStep = (completed: NewPlayerGuideStep[]) => (
  newPlayerGuideSteps.find((step) => !completed.includes(step.id))
)

const NewPlayerGuide: React.FC<NewPlayerGuideProps> = ({
  page,
  ownedCharacterCount = 0,
  selectedCharacterAttribute
}) => {
  const navigate = useNavigate()
  const accountId = useAuthStore((state) => state.player?.player_id)
  const [guideState, setGuideState] = useState(getNewPlayerGuideState)

  useEffect(() => {
    const refresh = () => setGuideState(getNewPlayerGuideState())
    refresh()
    window.addEventListener(getGuideEventName(), refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(getGuideEventName(), refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [accountId])

  const nextStep = useMemo(() => getNextStep(guideState.completed), [guideState.completed])
  const progressText = `${guideState.completed.length}/${newPlayerGuideSteps.length}`
  const isComplete = !nextStep

  if (guideState.hidden && !isComplete) {
    return (
      <button className="new-player-guide-tab" onClick={() => setNewPlayerGuideHidden(false)}>
        新手指引 {progressText}
      </button>
    )
  }

  const completeStep = (step: NewPlayerGuideStep) => {
    setGuideState(completeNewPlayerGuideStep(step))
  }

  const renderPrimaryAction = () => {
    if (!nextStep) {
      return <button onClick={() => navigate('/dungeons')}>继续挑战副本</button>
    }
    if (nextStep.id === 'draw_character') {
      return page === 'gacha'
        ? <button onClick={() => navigate('/gacha')}>抽取一次角色</button>
        : <button onClick={() => navigate('/gacha')}>前往角色池</button>
    }
    if (nextStep.id === 'learn_dungeons') {
      return page === 'dungeons'
        ? <button onClick={() => completeStep('learn_dungeons')}>我已了解副本类型</button>
        : <button onClick={() => navigate('/dungeons')}>查看副本</button>
    }
    if (nextStep.id === 'run_exp_dungeon') {
      return page === 'dungeons'
        ? <button onClick={() => completeStep('run_exp_dungeon')}>我已挑战经验本</button>
        : <button onClick={() => navigate('/dungeons')}>前往经验本</button>
    }
    if (nextStep.id === 'level_character') {
      return page === 'characters'
        ? <button onClick={() => navigate('/characters')}>打开角色详情升级</button>
        : <button onClick={() => navigate('/characters')}>去角色管理</button>
    }
    if (nextStep.id === 'learn_elements') {
      return page === 'dungeons'
        ? <button onClick={() => completeStep('learn_elements')}>我已了解属性克制</button>
        : <button onClick={() => navigate('/dungeons')}>查看属性提示</button>
    }
    return null
  }

  const attributeTip = selectedCharacterAttribute
    ? `当前角色属性：${attributeNames[selectedCharacterAttribute] || selectedCharacterAttribute}，只能进入同属性经验本。推荐优先派输出职业挑战，经验结晶可跨属性培养其他未满级角色。`
    : ownedCharacterCount > 0
      ? '你已经拥有角色了。建议优先培养输出角色，再用其刷到的经验结晶培养坦克、治疗和辅助；暂时没有输出角色时可继续前往角色池抽取。'
      : '还没有抽到角色时，先去角色池完成一次抽取。'

  return (
    <section className="new-player-guide" aria-label="新手指引">
      <div className="guide-header">
        <div>
          <span>新手指引</span>
          <strong>{isComplete ? '基础流程已完成' : nextStep.title}</strong>
        </div>
        <div className="guide-progress">{progressText}</div>
      </div>

      <p>{isComplete ? '你已经跑通了新手核心闭环，可以继续刷更高难度副本和团队内容。' : nextStep.summary}</p>
      <p className="guide-page-tip">{pageTipMap[page]}</p>
      <p className="guide-page-tip">{attributeTip}</p>

      {page === 'dungeons' && (
        <div className="element-counter-strip">
          <span>风克火</span>
          <span>火克木</span>
          <span>木克风</span>
          <span>雷克水</span>
          <span>水克土</span>
          <span>土克雷</span>
          <span>光暗互克</span>
        </div>
      )}

      <div className="guide-steps">
        {newPlayerGuideSteps.map((step, index) => {
          const done = guideState.completed.includes(step.id)
          const active = nextStep?.id === step.id
          return (
            <div key={step.id} className={`guide-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
              <span>{done ? '✓' : index + 1}</span>
              <em>{step.title}</em>
            </div>
          )
        })}
      </div>

      <div className="guide-actions">
        {renderPrimaryAction()}
        {!isComplete && <button className="secondary" onClick={() => setNewPlayerGuideHidden(true)}>暂时收起</button>}
        {isComplete && <button className="secondary" onClick={resetNewPlayerGuide}>重新指引</button>}
      </div>
    </section>
  )
}

export default NewPlayerGuide
