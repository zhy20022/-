import { Body, Controller, Get, Headers, Param, Put, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { GameConfigsService } from './configs.service';

class UpsertConfigDto {
  @IsObject()
  payload: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

@Controller('configs')
export class GameConfigsController {
  constructor(
    private readonly config: ConfigService,
    private readonly configs: GameConfigsService,
  ) {}

  @Get()
  list() {
    return this.configs.list();
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.configs.getContentConfig(key);
  }

  @Put(':key')
  upsert(@Headers('x-admin-token') token: string | undefined, @Param('key') key: string, @Body() dto: UpsertConfigDto) {
    if (token !== this.config.get<string>('ADMIN_TOKEN', 'dev-admin-token')) {
      throw new UnauthorizedException('invalid admin token');
    }
    return this.configs.upsert(key, dto.payload, dto.version || 1);
  }
}
