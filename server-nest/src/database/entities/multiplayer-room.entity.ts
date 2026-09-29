import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type MultiplayerRoomStatus = 'waiting' | 'starting' | 'in_battle' | 'finished' | 'cancelled';

@Entity('multiplayer_rooms')
@Index(['status', 'updatedAt'])
@Index(['leaderPlayerId', 'status'])
export class MultiplayerRoomEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 80 })
  dungeonId: string;

  @Index()
  @Column()
  leaderPlayerId: string;

  @Column({ length: 20, default: 'waiting' })
  status: MultiplayerRoomStatus;

  @Column({ default: 5 })
  capacity: number;

  @Column({ default: 5 })
  maxCharactersPerMember: number;

  @Column({ type: 'uuid', nullable: true })
  battleSeed?: string | null;

  @Column({ type: 'uuid', nullable: true })
  battleRecordId?: string | null;

  @Column({ type: 'jsonb', default: [] })
  characterIds: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
