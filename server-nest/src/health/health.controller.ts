import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
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
    const status = await this.inspectDependencies();
    return {
      ok: status.db === 'ok' && status.redis === 'PONG',
      service: 'gamer-nest-api',
      ...status,
      time: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    return { ok: true, service: 'gamer-nest-api', time: new Date().toISOString() };
  }

  @Get('ready')
  async ready() {
    const status = await this.inspectDependencies();
    if (status.db !== 'ok' || status.redis !== 'PONG') {
      throw new ServiceUnavailableException({
        ok: false,
        service: 'gamer-nest-api',
        ...status,
        message: 'online dependencies are not ready',
      });
    }
    return { ok: true, service: 'gamer-nest-api', ...status, time: new Date().toISOString() };
  }

  private async inspectDependencies() {
    let db = 'unavailable';
    try {
      await this.dataSource.query('SELECT 1');
      db = 'ok';
    } catch {
      db = 'unavailable';
    }
    return { db, redis: await this.redis.ping() };
  }
}
