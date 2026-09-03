import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { IsArray, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { InventoryGrantItem, InventoryService } from './inventory.service';

class GrantItemDto implements InventoryGrantItem {
  @IsString()
  itemConfigId: string;

  @IsString()
  itemType: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

class GrantInventoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrantItemDto)
  items: GrantItemDto[];

  @IsOptional()
  @IsString()
  source?: string;
}

class ConsumeInventoryDto {
  @IsString()
  itemConfigId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly inventory: InventoryService,
  ) {}

  @Get(':playerId')
  list(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.inventory.list(playerId);
  }

  @Post(':playerId/grant')
  grant(@Headers('x-admin-token') token: string | undefined, @Param('playerId') playerId: string, @Body() dto: GrantInventoryDto) {
    if (token !== this.config.get<string>('ADMIN_TOKEN', 'dev-admin-token')) {
      throw new UnauthorizedException('invalid admin token');
    }
    return this.inventory.grant(playerId, dto.items, dto.source || 'api');
  }

  @Post(':playerId/consume')
  consume(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Body() dto: ConsumeInventoryDto) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.inventory.consume(playerId, dto.itemConfigId, dto.quantity);
  }

  @Post(':playerId/items/:itemId/lock')
  lock(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('itemId') itemId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.inventory.setLocked(playerId, itemId, true);
  }

  @Post(':playerId/items/:itemId/unlock')
  unlock(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('itemId') itemId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.inventory.setLocked(playerId, itemId, false);
  }

  @Get(':playerId/items/:itemId/dismantle-preview')
  dismantlePreview(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('itemId') itemId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.inventory.dismantlePreview(playerId, itemId);
  }

  @Post(':playerId/items/:itemId/dismantle')
  dismantle(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string, @Param('itemId') itemId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.inventory.dismantle(playerId, itemId);
  }
}
