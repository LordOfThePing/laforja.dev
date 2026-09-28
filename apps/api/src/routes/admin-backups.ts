import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Hono } from 'hono';
import type { AuthEnv } from '../auth.ts';

// Los archivos los escribe el servicio backup (ops/backup/loop.sh y backup.sh) en un volumen
// compartido; la API no ve los dumps ni las credenciales del bucket.
export type BackupRun = {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  stage: 'dump' | 'offsite' | 'done';
  file: string;
  size: number;
  offsite: 'off' | 'ok' | 'failed';
};

export type BackupConfig = { keepDays: number; bucket: string; provider: string };

export type BackupDump = { name: string; size: number; modifiedAt: string };

// loop.sh toca `alive` cada minuto: tres sin tocarlo es que el servicio no está corriendo.
const ALIVE_WINDOW_MS = 3 * 60_000;

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}

async function readJson<T>(path: string): Promise<T | null> {
  const text = await readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function parseDumps(tsv: string): BackupDump[] {
  return tsv
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length === 3)
    .map(([path, size, mtime]) => ({
      name: basename(path!),
      size: Number(size),
      modifiedAt: new Date(Number(mtime) * 1000).toISOString(),
    }))
    .filter((d) => Number.isFinite(d.size) && !Number.isNaN(Date.parse(d.modifiedAt)))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function readBackupStatus(dir: string, now = Date.now()) {
  const [aliveStat, requestStat, config, lastRun, lastError, dumps] = await Promise.all([
    stat(join(dir, 'alive')).catch(() => null),
    stat(join(dir, 'request')).catch(() => null),
    readJson<BackupConfig>(join(dir, 'config.json')),
    readJson<BackupRun>(join(dir, 'last-run.json')),
    readText(join(dir, 'last-error.txt')),
    readText(join(dir, 'dumps.tsv')),
  ]);
  return {
    available: true as const,
    alive: aliveStat !== null && now - aliveStat.mtimeMs < ALIVE_WINDOW_MS,
    lastSeenAt: aliveStat ? aliveStat.mtime.toISOString() : null,
    requested: requestStat !== null,
    config,
    lastRun,
    lastError: lastRun && !lastRun.ok ? lastError?.trim() || null : null,
    dumps: dumps ? parseDumps(dumps) : [],
  };
}

export function adminBackupRoutes(stateDir: string | undefined) {
  const app = new Hono<AuthEnv>();

  app.get('/backups', async (c) => {
    if (!stateDir) return c.json({ available: false });
    return c.json(await readBackupStatus(stateDir));
  });

  // El pedido es un archivo: loop.sh lo ve en menos de un minuto, hace el backup y lo borra.
  app.post('/backups/run', async (c) => {
    if (!stateDir) return c.json({ error: 'backups_unavailable' }, 409);
    try {
      await writeFile(join(stateDir, 'request'), new Date().toISOString());
    } catch (err) {
      console.error('backups: no se pudo dejar el pedido', err);
      return c.json({ error: 'backup_state_unwritable' }, 503);
    }
    return c.json({ requested: true }, 202);
  });

  return app;
}
