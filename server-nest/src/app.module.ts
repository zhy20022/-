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
} from './database/entities';
import { DailyGoalsController } from './daily-goals/daily-goals.controller';
import { DailyGoalsService } from './daily-goals/daily-goals.service';
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
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL', 'postgres://gamer:gamer_dev_password@localhost:5433/gamer_online'),
        entities,
        synchronize:
          config.get<string>('TYPEORM_SYNCHRONIZE') === 'true' ||
          (config.get<string>('NODE_ENV') !== 'production' && config.get<string>('TYPEORM_SYNCHRONIZE') !== 'false'),
        logging: config.get<string>('TYPEORM_LOGGING') === 'true',
      }),
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [
    AdminController,
    AuthController,
    BattleSettlementController,
    DailyGoalsController,
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
  ],
  providers: [
    AdminService,
    AuthService,
    BattleSettlementService,
    DailyGoalsService,
    FriendsAssistService,
    GachaService,
    GameConfigsService,
    GuildService,
    IdleService,
    InventoryService,
    PlayersService,
    RankingService,
    RedisService,
  ],
})
export class AppModule {}
