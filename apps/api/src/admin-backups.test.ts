import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { createApp } from './app.ts';
import { parseDumps, readBackupStatus } from './routes/admin-backups.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let dir: string;
let app: ReturnType<typeof createApp>;
let bare: ReturnType<typeof createApp>;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'laforja-backups-'));
  ({ app } = await createTestApp(undefined, dir));
  ({ app: bare } = await createTestApp());
  adminToken = await makeToken({ sub: 'google-admin', email: 'admin@example.com' });
  userToken = await makeToken({ sub: 'google-comun', email: 'comun@example.com' });
});

afterAll(() => rm(dir, { recursive: true, force: true }));

const get = (a: typeof app, token: string) =>
  a.request('/api/admin/backups', { headers: { Authorization: `Bearer ${token}` } });
const run = (a: typeof app, token: string) =>
  a.request('/api/admin/backups/run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

describe('backups en el panel', () => {
  test('solo admins', async () => {
    expect((await get(app, userToken)).status).toBe(404);
    expect((await run(app, userToken)).status).toBe(404);
  });

  test('sin BACKUP_STATE_DIR avisa que no está disponible y no acepta pedidos', async () => {
    expect(await (await get(bare, adminToken)).json()).toEqual({ available: false });
    expect((await run(bare, adminToken)).status).toBe(409);
  });

  test('sin archivos todavía: el servicio figura caído y sin datos', async () => {
    const body = (await (await get(app, adminToken)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ available: true, alive: false, requested: false, lastRun: null, dumps: [] });
  });

  test('lee estado, config, dumps y el error solo si la última corrida falló', async () => {
    await writeFile(join(dir, 'alive'), '');
    await writeFile(join(dir, 'config.json'), '{"keepDays":14,"bucket":"laforja-backups","provider":"Cloudflare"}');
    await writeFile(
      join(dir, 'dumps.tsv'),
      '/backups/laforja-20260926T000000Z.dump\t1000\t1790380800\n/backups/laforja-20260927T000000Z.dump\t2000\t1790467200\n',
    );
    await writeFile(
      join(dir, 'last-run.json'),
      '{"startedAt":"2026-09-27T00:00:00Z","finishedAt":"2026-09-27T00:00:05Z","ok":false,"stage":"offsite","file":"laforja-20260927T000000Z.dump","size":2000,"offsite":"failed"}',
    );
    await writeFile(join(dir, 'last-error.txt'), 'SignatureDoesNotMatch\n');

    const body = (await (await get(app, adminToken)).json()) as Awaited<ReturnType<typeof readBackupStatus>>;
    expect(body.alive).toBe(true);
    expect(body.config?.bucket).toBe('laforja-backups');
    expect(body.dumps.map((d) => d.name)).toEqual(['laforja-20260927T000000Z.dump', 'laforja-20260926T000000Z.dump']);
    expect(body.lastRun?.offsite).toBe('failed');
    expect(body.lastError).toBe('SignatureDoesNotMatch');

    await writeFile(join(dir, 'last-run.json'), '{"ok":true,"stage":"done","offsite":"ok"}');
    expect(((await (await get(app, adminToken)).json()) as { lastError: unknown }).lastError).toBeNull();
  });

  test('alive viejo cuenta como servicio caído', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(join(dir, 'alive'), old, old);
    expect((await readBackupStatus(dir)).alive).toBe(false);
  });

  test('«Hacer backup ahora» deja el pedido para loop.sh', async () => {
    const res = await run(app, adminToken);
    expect(res.status).toBe(202);
    expect(existsSync(join(dir, 'request'))).toBe(true);
    expect(((await (await get(app, adminToken)).json()) as { requested: boolean }).requested).toBe(true);
  });

  test('parseDumps ignora líneas rotas', () => {
    expect(parseDumps('basura\n/backups/x.dump\tno\t1\n\n')).toEqual([]);
  });
});
