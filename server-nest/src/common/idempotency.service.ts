import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OperationRequestEntity, PlayerEntity } from '../database/entities';

export interface MutationContext {
  manager: EntityManager;
  player: PlayerEntity;
}

@Injectable()
export class IdempotencyService {
  private readonly inFlight = new Map<string, { requestHash: string; promise: Promise<Record<string, unknown>> }>();

  constructor(private readonly dataSource: DataSource) {}

  async execute<T extends Record<string, unknown>>(
    playerId: string,
    operation: string,
    suppliedKey: string | undefined,
    request: unknown,
    work: (context: MutationContext) => Promise<T>,
  ): Promise<T & { idempotency: { key: string; operation: string; replayed: boolean } }> {
    const key = this.normalizeKey(suppliedKey);
    const requestHash = this.hashRequest(request);
    const flightKey = `${playerId}:${operation}:${key}`;
    const running = this.inFlight.get(flightKey);
    if (running) {
      if (running.requestHash !== requestHash) {
        throw new ConflictException('idempotency key is currently processing a different request');
      }
      const replay = await running.promise;
      return this.decorate(replay as T, key, operation, true);
    }

    const execution = this.dataSource.transaction(async (manager) => {
      const insert = await manager.createQueryBuilder()
        .insert()
        .into(OperationRequestEntity)
        .values({ playerId, operation, idempotencyKey: key, requestHash, response: null })
        .orIgnore()
        .returning(['id'])
        .execute();

      if (!insert.raw?.length) {
        const existing = await manager.findOne(OperationRequestEntity, {
          where: { playerId, operation, idempotencyKey: key },
          lock: { mode: 'pessimistic_write' },
        });
        if (!existing || !existing.response) {
          throw new ConflictException('operation is still being processed; retry shortly');
        }
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('idempotency key was already used with a different request');
        }
        return this.decorate(existing.response as T, key, operation, true);
      }

      const player = await manager.findOne(PlayerEntity, {
        where: { id: playerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!player) throw new ConflictException('player no longer exists');

      const value = this.toJson(await work({ manager, player }));
      await manager.update(
        OperationRequestEntity,
        { playerId, operation, idempotencyKey: key },
        { response: value as never },
      );
      return this.decorate(value as T, key, operation, false);
    });
    this.inFlight.set(flightKey, { requestHash, promise: execution });
    try {
      return await execution;
    } finally {
      if (this.inFlight.get(flightKey)?.promise === execution) {
        this.inFlight.delete(flightKey);
      }
    }
  }

  private normalizeKey(value?: string) {
    const key = String(value || randomUUID()).trim();
    if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new ConflictException('Idempotency-Key must be 8-128 letters, numbers, dots, colons, underscores, or hyphens');
    }
    return key;
  }

  private hashRequest(value: unknown) {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private toJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private decorate<T extends Record<string, unknown>>(value: T, key: string, operation: string, replayed: boolean) {
    return { ...value, idempotency: { key, operation, replayed } };
  }
}
