import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dataSource from './typeorm-data-source';
import {
  CURRENT_SCHEMA_VERSION,
  INITIAL_SCHEMA_TIMESTAMP,
  REQUIRED_CORE_COLUMNS,
  REQUIRED_GAME_TABLES,
} from './schema-version';

const MIGRATION_LOCK_ID = 26090302;

async function runMigrations() {
  await dataSource.initialize();
  await dataSource.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

  try {
    await adoptLegacySchema(dataSource);
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    const current = await readCurrentVersion(dataSource);

    if (current !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`schema version mismatch: expected ${CURRENT_SCHEMA_VERSION}, got ${current || 'none'}`);
    }

    console.log(applied.length > 0
      ? `[migration] applied ${applied.map((migration) => migration.name).join(', ')}`
      : `[migration] schema is current at ${current}`);
  } finally {
    await dataSource.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    await dataSource.destroy();
  }
}

async function adoptLegacySchema(connection: DataSource) {
  const rows = await connection.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [REQUIRED_GAME_TABLES],
  ) as Array<{ table_name: string }>;

  if (rows.length === 0) return;

  const present = new Set(rows.map((row) => row.table_name));
  const missingTables = REQUIRED_GAME_TABLES.filter((table) => !present.has(table));
  if (missingTables.length > 0) {
    throw new Error(`partial legacy schema detected; missing tables: ${missingTables.join(', ')}`);
  }

  const migrationTableExists = await connection.query(
    `SELECT to_regclass(current_schema() || '.typeorm_migrations') IS NOT NULL AS exists`,
  ) as Array<{ exists: boolean }>;
  if (migrationTableExists[0]?.exists) return;

  await assertCoreColumns(connection);
  await connection.transaction(async (manager) => {
    await manager.query(`
      CREATE TABLE "typeorm_migrations" (
        "id" SERIAL NOT NULL,
        "timestamp" bigint NOT NULL,
        "name" character varying NOT NULL,
        CONSTRAINT "PK_typeorm_migrations_id" PRIMARY KEY ("id")
      )
    `);
    await manager.query(
      `INSERT INTO "typeorm_migrations" ("timestamp", "name") VALUES ($1, $2)`,
      [INITIAL_SCHEMA_TIMESTAMP, CURRENT_SCHEMA_VERSION],
    );
  });
  console.log(`[migration] adopted verified legacy schema as ${CURRENT_SCHEMA_VERSION}`);
}

async function assertCoreColumns(connection: DataSource) {
  const rows = await connection.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [Object.keys(REQUIRED_CORE_COLUMNS)],
  ) as Array<{ table_name: string; column_name: string }>;

  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const columns = columnsByTable.get(row.table_name) || new Set<string>();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }

  const missingColumns = Object.entries(REQUIRED_CORE_COLUMNS).flatMap(([table, columns]) =>
    columns
      .filter((column) => !columnsByTable.get(table)?.has(column))
      .map((column) => `${table}.${column}`),
  );
  if (missingColumns.length > 0) {
    throw new Error(`legacy schema column validation failed: ${missingColumns.join(', ')}`);
  }
}

async function readCurrentVersion(connection: DataSource) {
  const rows = await connection.query(
    `SELECT "name" FROM "typeorm_migrations" ORDER BY "id" DESC LIMIT 1`,
  ) as Array<{ name: string }>;
  return rows[0]?.name || null;
}

runMigrations().catch((error) => {
  console.error(`[migration] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
