import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('player_characters')
export class PlayerCharacterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  playerId: string;

  @Index()
  @Column({ length: 80 })
  characterConfigId: string;

  @Column({ length: 24 })
  attributeType: string;

  @Column({ length: 48 })
  professionType: string;

  @Column({ default: 1 })
  level: number;

  @Column({ default: 0 })
  exp: number;

  @Column({ type: 'jsonb', default: {} })
  skillSlots: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  equipment: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
