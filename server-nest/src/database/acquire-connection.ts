import { QueryRunner } from 'typeorm';
import { setTimeout as delay } from 'node:timers/promises';

export async function acquireConnection(create: () => QueryRunner): Promise<QueryRunner> {
  for (let attempt = 0; ; attempt++) {
    const runner = create();
    try {
      await runner.connect();
      return runner;
    } catch (error) {
      await runner.release().catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (attempt >= 2 || !['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(code || '')) throw error;
      // No transaction or write has started, so retry cannot duplicate an account.
      await delay(100 * (attempt + 1));
    }
  }
}
