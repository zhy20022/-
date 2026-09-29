import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { OnlineFeaturesService } from './online-features.service';

class ShopExchangeDto { @IsString() itemId: string; }
class AssistModeDto { @IsBoolean() enabled: boolean; }
class FriendDto { @IsString() username: string; }

@Controller()
export class OnlineFeaturesController {
  constructor(private readonly auth: AuthService, private readonly features: OnlineFeaturesService) {}

  @Get('shop/:playerId')
  shop(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.shop(playerId); }
  @Post('shop/:playerId/exchange')
  exchange(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('playerId') playerId: string, @Body() dto: ShopExchangeDto) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.exchangeShopItem(playerId, dto.itemId, key); }

  @Get('social/:playerId')
  social(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.social(playerId); }
  @Post('social/:playerId/friends')
  addFriend(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: FriendDto) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.addFriend(playerId, dto.username); }
  @Delete('social/:playerId/friends/:friendId')
  removeFriend(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('friendId') friendId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.removeFriend(playerId, friendId); }
  @Post('social/:playerId/assist-mode')
  assistMode(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: AssistModeDto) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.setAssistMode(playerId, dto.enabled); }

  @Get('quests/:playerId/list')
  quests(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Query('type') type = 'all') { this.auth.assertPlayerAccess(authorization, playerId); return this.features.listQuests(playerId, type); }
  @Post('quests/:playerId/:questId/accept')
  acceptQuest(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('questId') questId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.acceptQuest(playerId, questId); }
  @Post('quests/:playerId/:questId/claim')
  claimQuest(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('playerId') playerId: string, @Param('questId') questId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.claimQuest(playerId, questId, key); }

  @Get('achievements/:playerId/list')
  achievements(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Query('category') category = 'all', @Query('rarity') rarity = 'all') { this.auth.assertPlayerAccess(authorization, playerId); return this.features.listAchievements(playerId, category, rarity); }
  @Post('achievements/:playerId/check')
  checkAchievements(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('playerId') playerId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.checkAchievements(playerId, key); }

  @Get('world-boss/:playerId/dungeons')
  worldBosses(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.worldBossList(playerId); }
  @Get('world-boss/:playerId/:dungeonId/status')
  worldBossStatus(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('dungeonId') dungeonId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.worldBossStatus(playerId, dungeonId); }
  @Post('world-boss/:playerId/:dungeonId/chests/:chestId/open')
  openChest(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('playerId') playerId: string, @Param('dungeonId') dungeonId: string, @Param('chestId') chestId: string) { this.auth.assertPlayerAccess(authorization, playerId); return this.features.openChest(playerId, dungeonId, chestId, key); }
}
