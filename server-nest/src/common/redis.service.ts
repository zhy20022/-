import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client?: Redis;
  private warnedUnavailable = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: Number(this.config.get<string>('REDIS_CONNECT_TIMEOUT_MS', '10000')),
      retryStrategy: (attempt) => Math.min(500 * attempt, 5000),
    });
    this.client.on('ready', () => {
      this.warnedUnavailable = false;
    });
    this.client.on('error', (error) => {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        console.warn(`[redis] unavailable: ${error.message}`);
      }
    });
    void this.client.connect().catch((error) => {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        console.warn(`[redis] unavailable: ${error.message}`);
      }
    });
  }

  get connection() {
    if (!this.client) {
      throw new Error('Redis client is not initialized');
    }
    return this.client;
  }

  async ping(): Promise<string> {
    if (!this.client) return 'not-initialized';
    try {
      return await this.client.ping();
    } catch {
      return 'unavailable';
    }
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }
}
