import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type MultiplayerInvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

@Entity('multiplayer_room_invitations')
@Index(['inviteePlayerId', 'status', 'createdAt'])
@Index(['roomId', 'inviteePlayerId', 'status'])
export class MultiplayerRoomInvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  roomId: string;

  @Column({ type: 'uuid' })
  inviterPlayerId: string;

  @Column({ type: 'uuid' })
  inviteePlayerId: string;

  @Column({ length: 20, default: 'pending' })
  status: MultiplayerInvitationStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
