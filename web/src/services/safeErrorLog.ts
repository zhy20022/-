const operations = [
  'auth.logout',
  'crafting.materials',
  'crafting.characters',
  'enhancement.equipment',
  'inventory.load',
  'inventory.transactions',
  'inventory.dismantlePreview',
  'dungeon.list',
  'dungeon.characters',
  'dungeon.detail',
  'character.battleSoul',
  'character.list',
  'character.lock',
  'character.equipment',
  'character.illustration',
  'character.materials',
  'character.dungeons',
  'character.expPreview',
] as const

type Operation = typeof operations[number]
type Category = 'http' | 'timeout' | 'cancelled' | 'network' | 'unexpected'

export const safeErrorLog = (operation: Operation, error: unknown) => {
  let status: number | undefined
  let category: Category = 'unexpected'
  // Only bounded scalar fields leave this boundary; never forward the error object.
  try {
    const failure = error as { response?: { status?: unknown }; code?: unknown; isAxiosError?: unknown } | null
    const candidate = failure?.response?.status
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      status = candidate
      category = 'http'
    } else if (failure?.code === 'ECONNABORTED' || failure?.code === 'ETIMEDOUT') {
      category = 'timeout'
    } else if (failure?.code === 'ERR_CANCELED') {
      category = 'cancelled'
    } else if (failure?.isAxiosError === true) {
      category = 'network'
    }
  } catch {
    // Untrusted getters must not prevent the caller's error feedback or cleanup.
  }
  console.error('Gamer operation failed', {
    operation: operations.includes(operation) ? operation : 'unknown',
    category,
    ...(status === undefined ? {} : { status }),
  })
}
