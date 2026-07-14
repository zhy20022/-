import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('friend_assist_records')
@Index(['helperPlayerId', 'createdAt'])
@Index(['borrowerPlayerId', 'createdAt'])
export class FriendAssistRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  borrowerPlayerId: string;

  @Column()
  helperPlayerId: string;

  @Column({ type: 'uuid', nullable: true })
  helperCharacterId?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  dungeonId?: string | null;

  @Column({ default: 0 })
  rewardGold: number;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
