import { sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import type { Db } from './db/client.ts';
import { users } from './db/schema.ts';

export const JWT_AUDIENCE = 'laforja-api';

export type AuthUser = typeof users.$inferSelect;
export type AuthEnv = { Variables: { user: AuthUser } };

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

export function requireAuth(db: Db, secret: string) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    const token = header?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return c.json({ error: 'unauthorized' }, 401);

    let claims: Claims | null;
    try {
      claims = parseClaims(await verify(token, secret, { alg: 'HS256', aud: JWT_AUDIENCE }));
    } catch {
      claims = null;
    }
    if (!claims) return c.json({ error: 'unauthorized' }, 401);

    c.set('user', await upsertUser(db, claims));
    await next();
  });
}
