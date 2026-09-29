import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('multiplayer_room_members')
@Index(['roomId', 'playerId'], { unique: true })
@Index(['playerId', 'updatedAt'])
export class MultiplayerRoomMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  roomId: string;

  @Column({ type: 'uuid' })
  playerId: string;

  @Column({ type: 'jsonb', default: [] })
  characterIds: string[];

  @Column({ default: false })
  isReady: boolean;

  @CreateDateColumn()
  joinedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
