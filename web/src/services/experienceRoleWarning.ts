const nonDamageRoles = new Set([
  'PHYSICAL_TANK', 'MAGIC_TANK', 'HEALER', 'SUPPORT',
  '物理坦克', '法系坦克', '治疗', '辅助'
])

export const isExperienceSupportRole = (profession: string) => nonDamageRoles.has(profession)

const localDay = (now: Date) => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
const storageKey = (accountId: string) => `gamer:experience-role-warning:${accountId}`

export const isExperienceRoleWarningMuted = (accountId?: string, now = new Date()): boolean => {
  if (!accountId) return false
  try {
    return localStorage.getItem(storageKey(accountId)) === localDay(now)
  } catch {
    return false
  }
}

export const muteExperienceRoleWarningToday = (accountId?: string, now = new Date()) => {
  if (!accountId) return
  try {
    localStorage.setItem(storageKey(accountId), localDay(now))
  } catch {
    // Storage may be unavailable; the warning must never prevent a challenge.
  }
}
