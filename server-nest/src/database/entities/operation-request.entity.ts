import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('operation_requests')
@Index(['playerId', 'operation', 'idempotencyKey'], { unique: true })
@Index(['playerId', 'createdAt'])
export class OperationRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  playerId: string;

  @Column({ length: 80 })
  operation: string;

  @Column({ length: 128 })
  idempotencyKey: string;

  @Column({ length: 64 })
  requestHash: string;

  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
