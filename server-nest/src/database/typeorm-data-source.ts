import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/environment';
import { gameEntities } from './entities-list';

validateEnvironment(process.env);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: gameEntities,
  migrations: [`${__dirname}/migrations/*{.js,.ts}`],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  extra: {
    max: Number(process.env.DB_POOL_MAX || 20),
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  },
});
