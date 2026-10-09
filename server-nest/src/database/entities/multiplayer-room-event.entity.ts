import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('multiplayer_room_events')
@Index(['roomId', 'version'], { unique: true })
@Index(['createdAt'])
export class MultiplayerRoomEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  roomId: string;

  @Column({ type: 'bigint' })
  version: string;

  @Column({ length: 40 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
