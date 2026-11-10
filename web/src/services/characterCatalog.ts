import { CHARACTER_POOL } from '../data/characterPool'

export interface CharacterCatalogEntry {
  configId: string
  number: number
  name: string
}

export interface CharacterNumberSource {
  character_id?: string
  config_id?: string
  characterConfigId?: string
  character_config_id?: string
  number?: number
  character_number?: number
  name?: string
}

const isValidNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
)

export const localCharacterCatalog: CharacterCatalogEntry[] = CHARACTER_POOL.map((entry) => ({
  configId: entry.id,
  number: entry.number,
  name: entry.name,
}))

export const createCharacterNumberMap = (entries: CharacterCatalogEntry[] = localCharacterCatalog) => {
  const map = new Map<string, number>()
  const seen = new Set<number>()

  for (const entry of entries) {
    if (!entry.configId || !isValidNumber(entry.number) || seen.has(entry.number) || map.has(entry.configId)) {
      throw new Error('角色目录包含缺失、重复或无效编号')
    }
    map.set(entry.configId, entry.number)
    seen.add(entry.number)
  }

  return map
}

export const getCharacterNumber = (
  character: CharacterNumberSource,
  numberMap: Map<string, number> = createCharacterNumberMap(),
) => {
  const configId = character.config_id
    || character.characterConfigId
    || character.character_config_id
  if (configId && numberMap.has(configId)) return numberMap.get(configId)

  // Explicit response numbers are usable only when no configuration mapping exists.
  if (isValidNumber(character.character_number)) return character.character_number
  if (isValidNumber(character.number)) return character.number
  return undefined
}

export const compareCharactersByNumber = (
  left: CharacterNumberSource,
  right: CharacterNumberSource,
  numberMap: Map<string, number> = createCharacterNumberMap(),
) => {
  const leftNumber = getCharacterNumber(left, numberMap)
  const rightNumber = getCharacterNumber(right, numberMap)

  if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
    return leftNumber - rightNumber
  }
  if (leftNumber !== undefined && rightNumber === undefined) return -1
  if (leftNumber === undefined && rightNumber !== undefined) return 1

  return String(left.character_id || '').localeCompare(String(right.character_id || ''))
}

