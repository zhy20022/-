import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('world_boss_states')
@Index(['dungeonId', 'seasonId'], { unique: true })
export class WorldBossStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 80 })
  dungeonId: string;

  @Column({ length: 80 })
  seasonId: string;

  @Column({ default: 1 })
  currentLayer: number;

  @Column({ default: 0 })
  currentLayerDamage: number;

  @Column({ default: 1000000 })
  currentLayerMaxHp: number;

  @Column({ type: 'jsonb', default: [] })
  layerHistory: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', default: [] })
  announcements: Array<Record<string, unknown>>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
