const professionLabels: Record<string, string> = {
  PHYSICAL_TANK: '物理坦克',
  MAGIC_TANK: '法系坦克',
  PHYSICAL_MELEE_DPS: '物理近战输出',
  PHYSICAL_RANGED_DPS: '物理远程输出',
  MAGIC_MELEE_DPS: '法系近战输出',
  MAGIC_RANGED_DPS: '法系远程输出',
  HEALER: '治疗',
  SUPPORT: '辅助',
  PHYSICAL_DPS: '物理输出',
  MAGIC_DPS: '法系输出',
  UNKNOWN: '未知职业',
}

export const getProfessionLabel = (profession: string) => professionLabels[profession] || profession || '未知职业'
