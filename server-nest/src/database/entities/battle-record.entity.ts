import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('battle_records')
export class BattleRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Index()
  @Column({ length: 80 })
  dungeonId: string;

  @Column({ default: false })
  success: boolean;

  @Column({ type: 'float', default: 0 })
  duration: number;

  @Column({ default: 0 })
  damageScore: number;

  @Column({ type: 'jsonb', default: [] })
  characterIds: string[];

  @Column({ type: 'jsonb', default: {} })
  rewards: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  resultPayload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
