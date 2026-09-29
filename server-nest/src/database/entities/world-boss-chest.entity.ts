import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('world_boss_chests')
@Index(['playerId', 'dungeonId', 'seasonId', 'layer'], { unique: true })
export class WorldBossChestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Column({ length: 80 })
  dungeonId: string;

  @Column({ length: 80 })
  seasonId: string;

  @Column()
  layer: number;

  @Column()
  tier: number;

  @Column({ length: 16, default: 'unopened' })
  status: 'unopened' | 'opened';

  @Column({ type: 'jsonb', default: {} })
  rewardPayload: Record<string, unknown>;

  @Column({ type: 'timestamp', nullable: true })
  openedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
