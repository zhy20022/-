import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_items')
export class InventoryItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Index()
  @Column({ length: 80 })
  itemConfigId: string;

  @Column({ length: 32 })
  itemType: string;

  @Column({ default: 0 })
  quantity: number;

  @Column({ default: false })
  locked: boolean;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
