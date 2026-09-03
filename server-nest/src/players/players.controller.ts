import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { PlayersService } from './players.service';

class UseCharacterExpDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  levelDelta?: number;
}

class ConfigureSkillsDto {
  @IsObject()
  skillSlots: Record<string, string[]>;
}

class EquipCharacterDto {
  @IsString()
  itemId: string;
}

class UnequipCharacterDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  slot?: string;
}

@Controller('players')
export class PlayersController {
  constructor(
    private readonly auth: AuthService,
    private readonly players: PlayersService,
  ) {}

  @Get(':playerId/profile')
  profile(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.getProfile(playerId);
  }

  @Get(':playerId/characters/:characterId/exp-preview')
  expPreview(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('characterId') characterId: string,
    @Query('levelDelta') levelDelta?: string,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.expPreview(playerId, characterId, Number(levelDelta || 1));
  }

  @Post(':playerId/characters/:characterId/use-exp')
  useExp(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('characterId') characterId: string,
    @Body() dto: UseCharacterExpDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.useExp(playerId, characterId, dto);
  }

  @Get(':playerId/characters/:characterId/skills')
  skills(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('characterId') characterId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.getSkills(playerId, characterId);
  }

  @Post(':playerId/characters/:characterId/skills')
  configureSkills(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('characterId') characterId: string,
    @Body() dto: ConfigureSkillsDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.configureSkills(playerId, characterId, dto.skillSlots);
  }

  @Get(':playerId/characters/:characterId/equipment-options')
  equipmentOptions(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('characterId') characterId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.equipmentOptions(playerId, characterId);
  }

  @Post(':playerId/characters/:characterId/equip')
  equip(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('characterId') characterId: string,
    @Body() dto: EquipCharacterDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.equip(playerId, characterId, dto.itemId);
  }

  @Post(':playerId/characters/:characterId/unequip')
  unequip(
    @Headers('authorization') authorization: string | undefined,
    @Param('playerId') playerId: string,
    @Param('characterId') characterId: string,
    @Body() dto: UnequipCharacterDto,
  ) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.players.unequip(playerId, characterId, dto);
  }
}
