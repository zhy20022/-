import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin_logs')
export class AdminLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 80 })
  actor: string;

  @Column({ length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  targetId?: string | null;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
