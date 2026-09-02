import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  dungeons: '这里集中展示经验副本、五人本和20人团本。新手优先选择1人经验本。',
  characters: '这里可以查看已拥有角色，并在详情里用经验结晶升级。',
  battle: '战斗结束后，经验本奖励会汇入通用经验结晶。'
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
  const [guideState, setGuideState] = useState(getNewPlayerGuideState)

  useEffect(() => {
    const refresh = () => setGuideState(getNewPlayerGuideState())
    window.addEventListener(getGuideEventName(), refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(getGuideEventName(), refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

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
    ? `当前角色属性：${attributeNames[selectedCharacterAttribute] || selectedCharacterAttribute}。新手期优先打同属性经验本，资源归口后可给任意未满级角色使用。`
    : ownedCharacterCount > 0
      ? '你已经拥有角色了。下一步可以去副本页选择1人经验本。'
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
