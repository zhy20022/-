import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { WorkshopService } from './workshop.service';

class CraftPreviewDto {
  @IsIn(['exclusive', 'equipment'])
  craftingType: 'exclusive' | 'equipment';

  @IsOptional()
  @IsString()
  attributeType?: string;
}

class CraftExclusiveDto {
  @IsString()
  characterId: string;
}

class CraftEquipmentDto {
  @IsString()
  attributeType: string;

  @IsString()
  professionCategory: string;

  @IsString()
  slot: string;
}

@Controller('workshop')
export class WorkshopController {
  constructor(
    private readonly auth: AuthService,
    private readonly workshop: WorkshopService,
  ) {}

  @Get(':playerId/materials')
  materials(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.workshop.materials(playerId);
  }

  @Post(':playerId/crafting/preview')
  previewCraft(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: CraftPreviewDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.workshop.previewCraft(playerId, dto);
  }

  @Post(':playerId/crafting/exclusive')
  craftExclusive(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined, @Param('playerId') playerId: string, @Body() dto: CraftExclusiveDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.workshop.craftExclusive(playerId, dto.characterId, idempotencyKey);
  }

  @Post(':playerId/crafting/equipment')
  craftEquipment(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined, @Param('playerId') playerId: string, @Body() dto: CraftEquipmentDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.workshop.craftEquipment(playerId, dto, idempotencyKey);
  }

  @Get(':playerId/equipment/:itemId/enhancement')
  enhancementPreview(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('itemId') itemId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.workshop.enhancementPreview(playerId, itemId);
  }

  @Post(':playerId/equipment/:itemId/enhance')
  enhance(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined, @Param('playerId') playerId: string, @Param('itemId') itemId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.workshop.enhance(playerId, itemId, idempotencyKey);
  }

  @Post(':playerId/equipment/:itemId/breakthrough')
  breakthrough(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined, @Param('playerId') playerId: string, @Param('itemId') itemId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.workshop.breakthrough(playerId, itemId, idempotencyKey);
  }
}
