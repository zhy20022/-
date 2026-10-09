import { io } from 'socket.io-client'
import { getOnlineApiBase } from '../config'
import { reduceRoomEvent, reduceRoomSnapshot, validVersion } from './roomRealtimeState'
import type { RoomEvent, RoomRecovery, VersionedRoom } from './roomRealtimeState'

export function connectRoom<T extends VersionedRoom>(options: {
  initial: T; token: string; onRoom: (room: T) => void; onFallback: () => void
}) {
  if (window.__GAMER_RUNTIME_CONFIG__?.roomRealtime === false || import.meta.env.VITE_ROOM_REALTIME === 'false') {
    return () => undefined
  }
  const origin = new URL(getOnlineApiBase(), window.location.origin).origin
  const socket = io(`${origin}/rooms`, {
    auth: { token: options.token }, transports: ['websocket'], reconnection: true,
    reconnectionDelay: 500, reconnectionDelayMax: 5000, timeout: 8000,
  })
  let room = options.initial
  let disposed = false
  let recovering = false
  let connectionGeneration = 0
  let buffered: RoomEvent<T>[] = []
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const publish = (next: T) => { room = next; options.onRoom(next) }
  const fallback = () => { if (!disposed) options.onFallback() }
  const recover = (snapshot = false) => {
    if (disposed || recovering || !socket.connected) return
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined }
    const generation = connectionGeneration
    recovering = true
    socket.timeout(8000).emit('room.subscribe', {
      roomId: room.room_id, ...(snapshot ? {} : { version: room.version }),
    }, (error: unknown, response: RoomRecovery<T> & { error?: unknown }) => {
      if (disposed || generation !== connectionGeneration) return
      recovering = false
      if (error || response?.error || !response || response.roomId !== room.room_id || !validVersion(response.version)) {
        fallback()
        retryTimer = setTimeout(() => recover(true), 5000)
        return
      }
      try {
        let next = room
        if (response.mode === 'snapshot' && response.snapshot?.room_id === room.room_id &&
          response.snapshot.version === response.version) next = reduceRoomSnapshot(next, response.snapshot)
        else if (response.mode === 'events' && response.events) {
          for (const event of response.events) {
            const result = reduceRoomEvent(next, event)
            if (result.gap) throw new Error('incomplete recovery')
            next = result.room
          }
        } else throw new Error('invalid recovery')
        if (BigInt(next.version) < BigInt(response.version)) throw new Error('incomplete recovery')
        publish(next)
        const pending = buffered
        buffered = []
        for (const event of pending) {
          const result = reduceRoomEvent(room, event)
          if (result.gap) { recover(); break }
          if (result.room !== room) publish(result.room)
        }
      } catch {
        buffered = []
        fallback()
        retryTimer = setTimeout(() => recover(true), 500)
      }
    })
  }
  socket.on('connect', () => recover())
  socket.on('room.event', (event: RoomEvent<T>) => {
    if (disposed) return
    if (recovering) {
      if (buffered.length < 100) buffered.push(event)
      else { buffered = []; fallback() }
      return
    }
    const result = reduceRoomEvent(room, event)
    if (result.gap) recover()
    else if (result.room !== room) publish(result.room)
  })
  socket.on('room.sync', (response: RoomRecovery<T>) => {
    if (disposed || response.roomId !== room.room_id || response.snapshot?.room_id !== room.room_id ||
      response.snapshot.version !== response.version) return
    try { publish(reduceRoomSnapshot(room, response.snapshot)) } catch { fallback(); recover(true) }
  })
  socket.on('disconnect', () => { connectionGeneration++; recovering = false; buffered = []; fallback() })
  socket.on('connect_error', fallback)
  socket.on('room.revoked', fallback)
  return () => {
    disposed = true
    if (retryTimer) clearTimeout(retryTimer)
    socket.removeAllListeners()
    socket.disconnect()
  }
}
