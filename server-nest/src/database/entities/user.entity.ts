import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type UserStatus = 'active' | 'banned';
export type UserProvider = 'guest' | 'password' | 'wechat' | 'apple';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 64 })
  accountId: string;

  @Column({ length: 24, default: 'guest' })
  provider: UserProvider;

  @Column({ type: 'varchar', length: 120, nullable: true })
  passwordHash?: string | null;

  @Column({ length: 24, default: 'active' })
  status: UserStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
