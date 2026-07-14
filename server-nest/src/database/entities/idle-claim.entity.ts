import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('idle_claims')
@Index(['playerId', 'createdAt'])
export class IdleClaimEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Index()
  @Column()
  sessionId: string;

  @Column({ length: 80 })
  stageId: string;

  @Column({ default: 0 })
  elapsedSeconds: number;

  @Column({ default: 0 })
  cappedSeconds: number;

  @Column({ type: 'jsonb', default: [] })
  rewards: Array<Record<string, unknown>>;

  @Column({ default: 0 })
  goldGranted: number;

  @CreateDateColumn()
  createdAt: Date;
}
