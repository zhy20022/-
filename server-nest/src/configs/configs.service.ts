import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { EntityManager, Repository } from 'typeorm';
import { GameConfigEntity } from '../database/entities';

@Injectable()
export class GameConfigsService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GameConfigEntity) private readonly configs: Repository<GameConfigEntity>,
  ) {}

  async list() {
    const dbConfigs = await this.configs.find({ order: { configKey: 'ASC' } });
    return {
      database: dbConfigs,
      contentFiles: this.getKnownContentKeys().map((key) => ({ key, available: this.fileExists(key) })),
    };
  }

  async getContentConfig(key: string, manager?: EntityManager) {
    const configs = manager?.getRepository(GameConfigEntity) || this.configs;
    const dbConfig = await configs.findOne({ where: { configKey: key, enabled: true } });
    if (dbConfig) {
      return { source: 'database', key, version: dbConfig.version, payload: dbConfig.payload };
    }
    const filePath = this.getContentFilePath(key);
    if (!existsSync(filePath)) {
      return { source: 'missing', key, payload: null };
    }
    const raw = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    return { source: 'file', key, payload: JSON.parse(raw) };
  }

  async upsert(key: string, payload: Record<string, unknown>, version = 1) {
    let row = await this.configs.findOne({ where: { configKey: key } });
    if (!row) {
      row = this.configs.create({ configKey: key, payload, version, enabled: true });
    } else {
      row.payload = payload;
      row.version = version;
      row.enabled = true;
    }
    return this.configs.save(row);
  }

  private getKnownContentKeys() {
    return [
      'skills',
      'characters',
      'dungeons',
      'monsters',
      'bosses',
      'drops',
      'gacha_pools',
      'equipment',
      'activities',
      'level_exp',
      'idle_stages',
      'daily_goals',
      'reward_rules',
    ];
  }

  private fileExists(key: string) {
    return existsSync(this.getContentFilePath(key));
  }

  private getContentFilePath(key: string) {
    const contentDir = this.config.get<string>('CONTENT_DIR', '../data/content');
    return resolve(process.cwd(), join(contentDir, `${key}.json`));
  }
}
