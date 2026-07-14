import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('guilds')
export class GuildEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 40 })
  name: string;

  @Column()
  leaderPlayerId: string;

  @Column({ default: 1 })
  level: number;

  @Column({ default: 0 })
  contribution: number;

  @Column({ default: 30 })
  memberLimit: number;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
