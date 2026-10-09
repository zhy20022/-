import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MultiplayerRoomEntity, MultiplayerRoomEventEntity } from '../database/entities';

@Injectable()
export class RoomEventsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(@InjectRepository(MultiplayerRoomEventEntity) private readonly events: Repository<MultiplayerRoomEventEntity>) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.prune().catch(() => undefined), 60000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async prune() {
    const hours = Math.max(1, Number(process.env.ROOM_EVENT_RETENTION_HOURS || 24));
    await this.events.createQueryBuilder().delete().where('"createdAt" < :cutoff', {
      cutoff: new Date(Date.now() - hours * 3600000),
    }).execute();
  }

  // Caller holds the room write lock (or has just inserted it) in this transaction.
  async append(manager: EntityManager, room: MultiplayerRoomEntity, eventType: string, snapshot: Record<string, unknown>) {
    room.stateVersion = (BigInt(room.stateVersion || '0') + 1n).toString();
    await manager.save(room);
    snapshot.version = room.stateVersion;
    await manager.save(manager.create(MultiplayerRoomEventEntity, {
      roomId: room.id, version: room.stateVersion, eventType, payload: snapshot,
    }));
    return snapshot;
  }

  async recover(manager: EntityManager, room: MultiplayerRoomEntity, cursor: unknown, snapshot: Record<string, unknown>) {
    if (cursor !== undefined && cursor !== null &&
      (typeof cursor !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(cursor) || BigInt(cursor) > BigInt(room.stateVersion))) {
      throw new BadRequestException('invalid or future room version');
    }
    if (cursor == null) return { mode: 'snapshot', roomId: room.id, version: room.stateVersion, snapshot };
    const rows: MultiplayerRoomEventEntity[] = await manager.createQueryBuilder(MultiplayerRoomEventEntity, 'event')
      .where('event.roomId = :roomId AND event.version > :cursor', { roomId: room.id, cursor })
      .orderBy('event.version', 'ASC').take(101).getMany();
    let next = BigInt(cursor as string);
    const complete = rows.length <= 100 && rows.every(row => BigInt(row.version) === ++next) && next === BigInt(room.stateVersion);
    if (!complete) return { mode: 'snapshot', roomId: room.id, version: room.stateVersion, snapshot };
    return {
      mode: 'events', roomId: room.id, version: room.stateVersion,
      events: rows.map(row => ({
        roomId: row.roomId, eventId: row.id, version: row.version,
        eventType: row.eventType, payload: row.payload, createdAt: row.createdAt,
      })),
    };
  }
}
