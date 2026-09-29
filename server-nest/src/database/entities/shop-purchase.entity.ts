import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('shop_purchases')
@Index(['playerId', 'itemId', 'periodKey'], { unique: true })
export class ShopPurchaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Column({ length: 80 })
  itemId: string;

  @Column({ length: 32 })
  periodKey: string;

  @Column({ default: 0 })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;
}
