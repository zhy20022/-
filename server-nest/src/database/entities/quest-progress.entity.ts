import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('quest_progress')
@Index(['playerId', 'questId', 'periodKey'], { unique: true })
export class QuestProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Column({ length: 80 })
  questId: string;

  @Column({ length: 16, default: 'permanent' })
  periodKey: string;

  @Column({ length: 24, default: 'LOCKED' })
  status: string;

  @Column({ type: 'jsonb', default: {} })
  objectivesProgress: Record<string, number>;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
