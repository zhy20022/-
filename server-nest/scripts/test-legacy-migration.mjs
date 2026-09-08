import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DataSource } from 'typeorm';
import pg from 'pg';
import initial from '../dist/database/migrations/1788502608304-InitialOnlineSchema.js';

const url = new URL(process.env.E2E_DATABASE_URL || '');
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'use an isolated local PostgreSQL instance');
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
const database = `audit_legacy_${randomUUID().replaceAll('-', '')}`;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const connection = new DataSource({ type: 'postgres', url: url.toString(), synchronize: false });
  await connection.initialize();
  const runner = connection.createQueryRunner();
  try {
    await new initial.InitialOnlineSchema1788502608304().up(runner);
  } finally {
    await runner.release();
    await connection.destroy();
  }
  for (let run = 0; run < 2; run++) {
    const output = execFileSync(process.execPath, ['dist/database/run-migrations.js'], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url.toString(), DB_POOL_MAX: '1' },
      encoding: 'utf8', timeout: 30000,
    });
    console.log(output.trim());
  }
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    const { rows } = await db.query('SELECT name FROM typeorm_migrations ORDER BY id');
    assert.deepEqual(rows.map(row => row.name), ['InitialOnlineSchema1788502608304', 'ConcurrentMutationSafety1788509000000']);
    await db.query('SELECT count(*) FROM operation_requests');
    console.log('PASS: legacy adoption, subsequent migration, repeated startup, and a pool-size-one configuration');
  } finally {
    await db.end();
  }
} finally {
  await admin.end();
}
