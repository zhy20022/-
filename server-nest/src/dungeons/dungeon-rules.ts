export function sweepRequirement(type: string) {
  return type === 'SQUAD' ? 5 : 10;
}

export function sweepClearCount(type: string, progress?: {
  successfulAttempts?: number;
  bestRecord?: Record<string, unknown>;
} | null) {
  if (type === 'SINGLE') return Number(progress?.successfulAttempts || 0);
  return Number(progress?.bestRecord?.[type === 'SQUAD' ? 'soloClears' : 'flawlessCount'] || 0);
}

export function bossMaterialCount(killed: number, spawned: number, success: boolean) {
  const kills = Math.max(0, Math.floor(killed));
  return kills + (success && spawned > 0 && kills >= spawned ? 2 : 0);
}

export function playbackTime(ticket: Record<string, unknown>, now = Date.now()) {
  const clock = ticket.playback as { elapsed: number; updatedAt: string; speed: number } | undefined;
  return clock
    ? clock.elapsed + Math.max(0, now - Date.parse(clock.updatedAt)) / 1000 * clock.speed
    : Math.max(0, now - Date.parse(String(ticket.serverTime))) / 1000 * 4;
}
