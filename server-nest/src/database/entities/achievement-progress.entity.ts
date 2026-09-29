import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('achievement_progress')
@Index(['playerId', 'achievementId'], { unique: true })
export class AchievementProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Column({ length: 80 })
  achievementId: string;

  @Column({ default: false })
  unlocked: boolean;

  @Column({ type: 'timestamp', nullable: true })
  unlockedAt?: Date | null;

  @Column({ type: 'jsonb', default: {} })
  progress: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
