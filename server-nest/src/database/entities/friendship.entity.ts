import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type FriendshipStatus = 'pending' | 'accepted' | 'rejected' | 'blocked';

@Entity('friendships')
@Index(['requesterPlayerId', 'addresseePlayerId'], { unique: true })
export class FriendshipEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  requesterPlayerId: string;

  @Index()
  @Column()
  addresseePlayerId: string;

  @Column({ length: 24, default: 'pending' })
  status: FriendshipStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
