import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { BattleSettlementController } from './battle-settlement/battle-settlement.controller';
import { BattleSettlementService } from './battle-settlement/battle-settlement.service';
import { RedisService } from './common/redis.service';
import { GameConfigsController } from './configs/configs.controller';
import { GameConfigsService } from './configs/configs.service';
import { gameEntities } from './database/entities-list';
import { DatabaseBackupService } from './database/database-backup.service';
import { DailyGoalsController } from './daily-goals/daily-goals.controller';
import { DailyGoalsService } from './daily-goals/daily-goals.service';
import { DungeonsController } from './dungeons/dungeons.controller';
import { DungeonsService } from './dungeons/dungeons.service';
import { FriendsAssistController } from './friends-assist/friends-assist.controller';
import { FriendsAssistService } from './friends-assist/friends-assist.service';
import { GachaController } from './gacha/gacha.controller';
import { GachaService } from './gacha/gacha.service';
import { GuildController } from './guild/guild.controller';
import { GuildService } from './guild/guild.service';
import { HealthController } from './health/health.controller';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { IdleController } from './idle/idle.controller';
import { IdleService } from './idle/idle.service';
import { MailController } from './mail/mail.controller';
import { PlayersController } from './players/players.controller';
import { PlayersService } from './players/players.service';
import { RankingController } from './ranking/ranking.controller';
import { RankingService } from './ranking/ranking.service';
import { validateEnvironment } from './config/environment';
import { WorkshopController } from './workshop/workshop.controller';
import { WorkshopService } from './workshop/workshop.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL', 'postgres://gamer:gamer_dev_password@localhost:5433/gamer_online'),
        entities: gameEntities,
        synchronize:
          config.get<string>('TYPEORM_SYNCHRONIZE') === 'true' ||
          (config.get<string>('NODE_ENV') !== 'production' && config.get<string>('TYPEORM_SYNCHRONIZE') !== 'false'),
        logging: config.get<string>('TYPEORM_LOGGING') === 'true',
        ssl: config.get<string>('DB_SSL') === 'true'
          ? { rejectUnauthorized: config.get<string>('DB_SSL_REJECT_UNAUTHORIZED') !== 'false' }
          : false,
        extra: {
          max: Number(config.get<string>('DB_POOL_MAX', '20')),
          connectionTimeoutMillis: Number(config.get<string>('DB_CONNECT_TIMEOUT_MS', '10000')),
        },
      }),
    }),
    TypeOrmModule.forFeature(gameEntities),
  ],
  controllers: [
    AdminController,
    AuthController,
    BattleSettlementController,
    DailyGoalsController,
    DungeonsController,
    FriendsAssistController,
    GameConfigsController,
    GachaController,
    GuildController,
    HealthController,
    IdleController,
    InventoryController,
    MailController,
    PlayersController,
    RankingController,
    WorkshopController,
  ],
  providers: [
    AdminService,
    AuthService,
    BattleSettlementService,
    DailyGoalsService,
    DatabaseBackupService,
    DungeonsService,
    FriendsAssistService,
    GachaService,
    GameConfigsService,
    GuildService,
    IdleService,
    InventoryService,
    PlayersService,
    RankingService,
    RedisService,
    WorkshopService,
  ],
})
export class AppModule {}
