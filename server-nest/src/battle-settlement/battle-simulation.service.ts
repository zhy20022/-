import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

export interface ServerBattle extends Record<string, unknown> {
  engineVersion: string;
  duration: number;
  success: boolean;
  survived: boolean;
  damageScore: number;
  singleMonstersKilled: number;
  groupMonstersKilled: number;
  units: Record<string, unknown>;
  frames: Array<{ time: number; units: unknown[] }>;
  events: Array<{ time: number; [key: string]: unknown }>;
}

@Injectable()
export class BattleSimulationService {
  private running = 0;

  constructor(private readonly config: ConfigService) {}

  async simulate(input: Record<string, unknown>): Promise<ServerBattle> {
    if (this.running >= 2) throw new ServiceUnavailableException('battle workers busy; retry shortly');
    const root = resolve(this.config.get<string>('BATTLE_WORKER_ROOT', '..'));
    const python = this.config.get<string>('BATTLE_PYTHON', process.platform === 'win32' ? 'python' : 'python3');
    const payload = JSON.stringify(input);
    if (Buffer.byteLength(payload) > 1_000_000) throw new ServiceUnavailableException('battle snapshot exceeds limit');
    this.running += 1;
    try {
      return await new Promise<ServerBattle>((accept, reject) => {
        const child = execFile(python, ['-S', '-X', 'utf8', resolve(root, 'scripts/nest_battle_worker.py')], {
          cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
          // The computation process never receives database credentials or auth keys.
          env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP, LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1' },
        }, (error, stdout) => {
          if (error) return reject(new ServiceUnavailableException('battle computation failed; no rewards were issued'));
          try {
            const result = JSON.parse(stdout) as ServerBattle;
            if (result.engineVersion !== 'authored-python-v1' || !Number.isFinite(result.duration) ||
                result.duration < 0 || result.duration > 300 || typeof result.success !== 'boolean' ||
                !Array.isArray(result.frames) || result.frames.length > 32 ||
                !Number.isSafeInteger(result.damageScore) || result.damageScore < 0) throw new Error('invalid worker result');
            accept(result);
          } catch {
            reject(new ServiceUnavailableException('invalid battle computation result'));
          }
        });
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(payload);
      });
    } finally {
      this.running -= 1;
    }
  }
}
