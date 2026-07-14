import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('gacha_records')
export class GachaRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Index()
  @Column({ length: 80 })
  poolKey: string;

  @Column({ default: 1 })
  drawCount: number;

  @Column({ type: 'jsonb', default: [] })
  results: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', default: {} })
  cost: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
