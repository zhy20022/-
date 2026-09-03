import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { validateEnvironment } from '../config/environment'
import {
  AdminLogEntity,
  BattleRecordEntity,
  DailyGoalProgressEntity,
  DungeonProgressEntity,
  FriendAssistRecordEntity,
  FriendshipEntity,
  GachaRecordEntity,
  GameConfigEntity,
  GuildContributionEntity,
  GuildEntity,
  GuildMemberEntity,
  IdleClaimEntity,
  IdleSessionEntity,
  InventoryItemEntity,
  MailEntity,
  PlayerCharacterEntity,
  PlayerEntity,
  RankingEntryEntity,
  UserEntity,
} from './entities'

const entities = [
  AdminLogEntity,
  BattleRecordEntity,
  DailyGoalProgressEntity,
  DungeonProgressEntity,
  FriendAssistRecordEntity,
  FriendshipEntity,
  GachaRecordEntity,
  GameConfigEntity,
  GuildContributionEntity,
  GuildEntity,
  GuildMemberEntity,
  IdleClaimEntity,
  IdleSessionEntity,
  InventoryItemEntity,
  MailEntity,
  PlayerCharacterEntity,
  PlayerEntity,
  RankingEntryEntity,
  UserEntity,
]

async function bootstrapSchema() {
  validateEnvironment(process.env)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities,
    synchronize: false,
    ssl: process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
  })

  await dataSource.initialize()
  try {
    await dataSource.query('SELECT pg_advisory_lock(26090301)')
    const existing = await dataSource.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name IN ('users', 'players')`,
    ) as Array<{ table_name: string }>

    if (existing.length === 0) {
      await dataSource.synchronize(false)
      console.log('[schema] initial NestJS schema created')
    } else if (existing.length !== 2) {
      throw new Error('partial online schema detected; expected both users and players tables')
    } else {
      console.log('[schema] existing NestJS schema detected')
    }

    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS deployment_schema_versions (
        version varchar(80) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await dataSource.query(
      `INSERT INTO deployment_schema_versions(version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
      ['0001-initial-online-schema'],
    )
  } finally {
    await dataSource.query('SELECT pg_advisory_unlock(26090301)').catch(() => undefined)
    await dataSource.destroy()
  }
}

bootstrapSchema().catch((error) => {
  console.error(`[schema] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
