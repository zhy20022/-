import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type IdleSessionStatus = 'active' | 'stopped';

@Entity('idle_sessions')
@Index(['playerId', 'status'])
export class IdleSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Column({ length: 80 })
  stageId: string;

  @Column({ type: 'jsonb', default: [] })
  characterIds: string[];

  @Column({ length: 20, default: 'active' })
  status: IdleSessionStatus;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz' })
  lastClaimedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
