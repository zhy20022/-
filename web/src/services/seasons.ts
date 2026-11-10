export const SEASONS = [
  { id: 1, name: '\u707e\u5384\u521d\u542f' },
  { id: 2, name: '\u7b2c\u4e8c\u8d5b\u5b63' },
  { id: 3, name: '\u7b2c\u4e09\u8d5b\u5b63' },
  { id: 4, name: '\u7b2c\u56db\u8d5b\u5b63' },
] as const

export interface SeasonSource {
  season?: number
  season_id?: number | string
  seasonId?: number | string
  era?: number
}

export const getSeasonNumber = (item: SeasonSource): number => {
  const value = Number(item.season ?? item.season_id ?? item.seasonId ?? item.era ?? 1)
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

export const SWEEP_UNLOCK_COUNT = 10
