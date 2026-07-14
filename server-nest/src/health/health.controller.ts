import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisService } from '../common/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async health() {
    const db = this.dataSource.isInitialized ? 'ok' : 'not-initialized';
    return {
      ok: true,
      service: 'gamer-nest-api',
      db,
      redis: await this.redis.ping(),
      time: new Date().toISOString(),
    };
  }
}
