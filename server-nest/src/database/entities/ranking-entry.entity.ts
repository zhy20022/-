import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('ranking_entries')
@Index(['seasonId', 'rankingKey', 'playerId'], { unique: true })
@Index(['seasonId', 'rankingKey', 'score'])
export class RankingEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 80 })
  rankingKey: string;

  @Column({ length: 80, default: 'default' })
  seasonId: string;

  @Column()
  playerId: string;

  @Column({ length: 80 })
  playerName: string;

  @Column({ default: 0 })
  score: number;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
