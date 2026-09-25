import { sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import type { Db } from './db/client.ts';
import { users } from './db/schema.ts';

export const JWT_AUDIENCE = 'laforja-api';

export type AuthUser = typeof users.$inferSelect;
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

async function upsertUser(db: Db, claims: Claims): Promise<AuthUser> {
  const [user] = await db
    .insert(users)
    .values({
      googleId: claims.sub,
      email: claims.email,
      name: claims.name,
      avatarUrl: claims.picture,
    })
    .onConflictDoUpdate({
      target: users.googleId,
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        avatarUrl: sql`excluded.avatar_url`,
      },
    })
    .returning();
  if (!user) throw new Error('El upsert de users no devolvió fila');
  return user;
}

type AuthResult = { kind: 'anonymous' } | { kind: 'invalid' } | { kind: 'user'; user: AuthUser };

async function authenticate(db: Db, secret: string, header: string | undefined): Promise<AuthResult> {
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
  return { kind: 'user', user: await upsertUser(db, claims) };
}

export function requireAuth(db: Db, secret: string) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const result = await authenticate(db, secret, c.req.header('Authorization'));
    if (result.kind !== 'user') return c.json({ error: 'unauthorized' }, 401);
    c.set('user', result.user);
    await next();
  });
}

// Sin header se sigue como anónimo; un token presente pero inválido es 401 para que
// el cliente se entere de que tiene que renovar la sesión en vez de ver todo bloqueado.
export function optionalAuth(db: Db, secret: string) {
  return createMiddleware<OptionalAuthEnv>(async (c, next) => {
    const result = await authenticate(db, secret, c.req.header('Authorization'));
    if (result.kind === 'invalid') return c.json({ error: 'unauthorized' }, 401);
    c.set('user', result.kind === 'user' ? result.user : null);
    await next();
  });
}
