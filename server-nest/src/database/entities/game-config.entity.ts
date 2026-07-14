import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('game_configs')
export class GameConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 80 })
  configKey: string;

  @Column({ default: 1 })
  version: number;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
