export const MAX_CHARACTER_LEVEL = 100;
export const TOTAL_EXP_TO_MAX_LEVEL = 100_000;
const MIN_EXP_PER_LEVEL = 100;

let cachedLevelTable: Map<number, number> | null = null;

export function getLevelExpTable() {
  if (cachedLevelTable) return cachedLevelTable;

  const levels = Array.from({ length: MAX_CHARACTER_LEVEL - 1 }, (_, index) => index + 1);
  const baseTotal = MIN_EXP_PER_LEVEL * levels.length;
  const remaining = TOTAL_EXP_TO_MAX_LEVEL - baseTotal;
  const weights = levels.map((level) => Math.pow(level, 1.45));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  const table = new Map<number, number>();
  let assigned = 0;
  levels.forEach((level, index) => {
    const cost = MIN_EXP_PER_LEVEL + Math.round((weights[index] / weightTotal) * remaining);
    table.set(level, cost);
    assigned += cost;
  });
  table.set(MAX_CHARACTER_LEVEL - 1, (table.get(MAX_CHARACTER_LEVEL - 1) || 0) + TOTAL_EXP_TO_MAX_LEVEL - assigned);
  cachedLevelTable = table;
  return table;
}

export function getExpForNextLevel(level: number) {
  if (level >= MAX_CHARACTER_LEVEL) return 0;
  return getLevelExpTable().get(Math.max(1, Math.floor(level || 1))) || 0;
}

export function getTotalExpBeforeLevel(level: number) {
  const cappedLevel = Math.min(Math.max(1, Math.floor(level || 1)), MAX_CHARACTER_LEVEL);
  let total = 0;
  for (let current = 1; current < cappedLevel; current += 1) {
    total += getExpForNextLevel(current);
  }
  return total;
}

export function getExpRequiredToLevel(level: number, exp: number, targetLevel: number) {
  const currentLevel = Math.min(Math.max(1, Math.floor(level || 1)), MAX_CHARACTER_LEVEL);
  const cappedTarget = Math.max(currentLevel, Math.min(Math.floor(targetLevel || currentLevel), MAX_CHARACTER_LEVEL));
  const currentTotal = getTotalExpBeforeLevel(currentLevel) + Math.max(0, Math.floor(exp || 0));
  const targetTotal = getTotalExpBeforeLevel(cappedTarget);
  return Math.max(0, targetTotal - currentTotal);
}

export function applyCharacterExp(level: number, exp: number, amount: number) {
  const beforeLevel = Math.min(Math.max(1, Math.floor(level || 1)), MAX_CHARACTER_LEVEL);
  const beforeExp = Math.max(0, Math.floor(exp || 0));
  let currentLevel = beforeLevel;
  let remainingExp = beforeExp + Math.max(0, Math.floor(amount || 0));

  while (currentLevel < MAX_CHARACTER_LEVEL) {
    const required = getExpForNextLevel(currentLevel);
    if (required <= 0 || remainingExp < required) break;
    remainingExp -= required;
    currentLevel += 1;
  }

  if (currentLevel >= MAX_CHARACTER_LEVEL) {
    currentLevel = MAX_CHARACTER_LEVEL;
    remainingExp = 0;
  }

  return {
    gainedExp: Math.max(0, Math.floor(amount || 0)),
    beforeLevel,
    afterLevel: currentLevel,
    beforeExp,
    afterExp: remainingExp,
    leveledUp: currentLevel > beforeLevel,
    expToNextLevel: getExpForNextLevel(currentLevel),
    maxLevel: MAX_CHARACTER_LEVEL,
    totalExpToMaxLevel: TOTAL_EXP_TO_MAX_LEVEL,
  };
}
