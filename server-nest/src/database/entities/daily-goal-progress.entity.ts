import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('daily_goal_progress')
@Index(['playerId', 'dateKey', 'goalKey'], { unique: true })
export class DailyGoalProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Index()
  @Column({ length: 10 })
  dateKey: string;

  @Column({ length: 80 })
  goalKey: string;

  @Column({ default: 0 })
  progress: number;

  @Column({ default: false })
  claimed: boolean;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
