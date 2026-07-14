import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('guild_contributions')
@Index(['guildId', 'createdAt'])
@Index(['playerId', 'createdAt'])
export class GuildContributionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  guildId: string;

  @Column()
  playerId: string;

  @Column({ default: 0 })
  amount: number;

  @Column({ length: 80, default: 'manual' })
  source: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
