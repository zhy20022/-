import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type GuildRole = 'leader' | 'officer' | 'member';

@Entity('guild_members')
@Index(['guildId', 'playerId'], { unique: true })
export class GuildMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  guildId: string;

  @Index({ unique: true })
  @Column()
  playerId: string;

  @Column({ length: 24, default: 'member' })
  role: GuildRole;

  @Column({ default: 0 })
  weeklyContribution: number;

  @Column({ default: 0 })
  totalContribution: number;

  @CreateDateColumn()
  joinedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
