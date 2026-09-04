import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { Response } from 'express';
import { CURRENT_SCHEMA_VERSION } from './schema-version';

@Injectable()
export class DatabaseBackupService {
  constructor(private readonly config: ConfigService) {}

  async streamLogicalBackup(response: Response) {
    const databaseUrl = this.config.get<string>('DATABASE_URL');
    if (!databaseUrl) throw new Error('DATABASE_URL is not configured');
    const connection = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
      throw new Error('DATABASE_URL must be a PostgreSQL connection string');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    response.status(200);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="gamer-${timestamp}.dump"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Backup-Schema-Version', CURRENT_SCHEMA_VERSION);
    response.setHeader('X-Backup-Git-Commit', this.config.get<string>('RENDER_GIT_COMMIT', 'local'));

    await new Promise<void>((resolve, reject) => {
      const child = spawn('pg_dump', [
        '--format=custom',
        '--compress=6',
        '--no-owner',
        '--no-privileges',
      ], {
        env: {
          ...process.env,
          PGAPPNAME: 'gamer-backup-export',
          PGHOST: connection.hostname,
          PGPORT: connection.port || '5432',
          PGUSER: decodeURIComponent(connection.username),
          PGPASSWORD: decodeURIComponent(connection.password),
          PGDATABASE: decodeURIComponent(connection.pathname.replace(/^\//, '')),
          ...(connection.searchParams.get('sslmode')
            ? { PGSSLMODE: connection.searchParams.get('sslmode') || undefined }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (code === 0) {
          response.end();
          finish();
          return;
        }
        finish(new Error(`pg_dump exited with code ${code}: ${stderr.trim() || 'no details'}`));
      });
      response.on('close', () => {
        if (!settled && !response.writableEnded) {
          child.kill('SIGTERM');
          finish(new Error('backup client disconnected'));
        }
      });
      child.stdout.pipe(response, { end: false });
    });
  }
}
