import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisService } from '../common/redis.service';
import { CURRENT_SCHEMA_VERSION } from '../database/schema-version';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async health() {
    const status = await this.inspectDependencies();
    return {
      ok: status.db === 'ok' && status.redis === 'PONG' && status.schemaReady,
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
    if (status.db !== 'ok' || status.redis !== 'PONG' || !status.schemaReady) {
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
    let schemaVersion = 'unmanaged';
    try {
      await this.dataSource.query('SELECT 1');
      db = 'ok';
      const rows = await this.dataSource.query(`
        SELECT "name" FROM "typeorm_migrations" ORDER BY "id" DESC LIMIT 1
      `) as Array<{ name: string }>;
      schemaVersion = rows[0]?.name || 'none';
    } catch {
      if (this.config.get<string>('NODE_ENV') === 'production') db = 'unavailable';
    }
    const production = this.config.get<string>('NODE_ENV') === 'production';
    return {
      db,
      redis: await this.redis.ping(),
      schemaVersion,
      requiredSchemaVersion: CURRENT_SCHEMA_VERSION,
      schemaReady: !production || schemaVersion === CURRENT_SCHEMA_VERSION,
      deploymentCommit: this.config.get<string>('RENDER_GIT_COMMIT', 'local'),
    };
  }
}
