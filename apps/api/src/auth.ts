import { sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import type { Db } from './db/client.ts';
import { users } from './db/schema.ts';

export const JWT_AUDIENCE = 'laforja-api';

export type AuthUser = typeof users.$inferSelect;
export type AuthConfig = {
  db: Db;
  secret: string;
  // Emails que se promueven a admin al loguearse. Sacar uno de la lista no lo degrada:
  // el rol vive en la DB y se cambia desde el panel.
  adminEmails: ReadonlySet<string>;
};
export type AuthEnv = { Variables: { user: AuthUser } };
export type OptionalAuthEnv = { Variables: { user: AuthUser | null } };

type Claims = {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
};

function parseClaims(payload: Record<string, unknown>): Claims | null {
  const { sub, email, name, picture, exp } = payload;
  // hono solo valida `exp` si viene; un token sin vencimiento no se acepta.
  if (typeof exp !== 'number') return null;
  if (typeof sub !== 'string' || !sub) return null;
  if (typeof email !== 'string' || !email) return null;
  return {
    sub,
    email,
    name: typeof name === 'string' ? name : null,
    picture: typeof picture === 'string' ? picture : null,
  };
}

export function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function upsertUser(
  db: Db,
  claims: Claims,
  adminEmails: ReadonlySet<string>,
): Promise<AuthUser> {
  const promote = adminEmails.has(claims.email.toLowerCase());
  const [user] = await db
    .insert(users)
    .values({
      googleId: claims.sub,
      email: claims.email,
      name: claims.name,
      avatarUrl: claims.picture,
      role: promote ? 'admin' : 'user',
    })
    .onConflictDoUpdate({
      target: users.googleId,
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        avatarUrl: sql`excluded.avatar_url`,
        ...(promote ? { role: 'admin' as const } : {}),
      },
    })
    .returning();
  if (!user) throw new Error('El upsert de users no devolvió fila');
  return user;
}

type AuthResult = { kind: 'anonymous' } | { kind: 'invalid' } | { kind: 'user'; user: AuthUser };

async function authenticate(
  { db, secret, adminEmails }: AuthConfig,
  header: string | undefined,
): Promise<AuthResult> {
  if (!header) return { kind: 'anonymous' };
  const token = header.match(/^Bearer (.+)$/)?.[1];
  if (!token) return { kind: 'invalid' };

  let claims: Claims | null;
  try {
    claims = parseClaims(await verify(token, secret, { alg: 'HS256', aud: JWT_AUDIENCE }));
  } catch {
    claims = null;
  }
  if (!claims) return { kind: 'invalid' };
  return { kind: 'user', user: await upsertUser(db, claims, adminEmails) };
}

export function requireAuth(auth: AuthConfig) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const result = await authenticate(auth, c.req.header('Authorization'));
    if (result.kind !== 'user') return c.json({ error: 'unauthorized' }, 401);
    c.set('user', result.user);
    await next();
  });
}

// Sin header se sigue como anónimo; un token presente pero inválido es 401 para que
// el cliente se entere de que tiene que renovar la sesión en vez de ver todo bloqueado.
export function optionalAuth(auth: AuthConfig) {
  return createMiddleware<OptionalAuthEnv>(async (c, next) => {
    const result = await authenticate(auth, c.req.header('Authorization'));
    if (result.kind === 'invalid') return c.json({ error: 'unauthorized' }, 401);
    c.set('user', result.kind === 'user' ? result.user : null);
    await next();
  });
}

// Va después de requireAuth. 404 en vez de 403 para no anunciar que el panel existe.
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'not_found' }, 404);
  await next();
});
