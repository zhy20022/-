import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('mails')
export class MailEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Column({ length: 80 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: [] })
  rewards: Array<Record<string, unknown>>;

  @Column({ default: false })
  claimed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
