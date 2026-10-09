export interface VersionedRoom { room_id: string; version: string }
export interface RoomEvent<T extends VersionedRoom> {
  roomId: string; eventId: string; version: string; eventType: string; payload: T; createdAt: string
}
export interface RoomRecovery<T extends VersionedRoom> {
  mode: 'snapshot' | 'events'; roomId: string; version: string; snapshot?: T; events?: RoomEvent<T>[]
}

export const validVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)

export function reduceRoomEvent<T extends VersionedRoom>(current: T, event: RoomEvent<T>) {
  if (!event || event.roomId !== current.room_id || event.payload?.room_id !== current.room_id ||
    !validVersion(event.version) || event.payload.version !== event.version) return { room: current, gap: true }
  if (BigInt(event.version) <= BigInt(current.version)) return { room: current, gap: false }
  if (BigInt(event.version) !== BigInt(current.version) + 1n) return { room: current, gap: true }
  return { room: event.payload, gap: false }
}

export function reduceRoomSnapshot<T extends VersionedRoom>(current: T | null, snapshot: T): T {
  if (!validVersion(snapshot.version)) throw new Error('invalid room snapshot version')
  if (current?.room_id === snapshot.room_id && BigInt(snapshot.version) < BigInt(current.version)) return current
  return snapshot
}
