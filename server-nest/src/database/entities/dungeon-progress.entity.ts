import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('dungeon_progress')
@Index(['playerId', 'dungeonId'], { unique: true })
export class DungeonProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  playerId: string;

  @Column({ length: 80 })
  dungeonId: string;

  @Column({ default: 0 })
  totalAttempts: number;

  @Column({ default: 0 })
  successfulAttempts: number;

  @Column({ default: 0 })
  failedAttempts: number;

  @Column({ default: 0 })
  bestDamageScore: number;

  @Column({ type: 'float', nullable: true })
  bestDuration?: number | null;

  @Column({ type: 'jsonb', default: {} })
  bestRecord: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
