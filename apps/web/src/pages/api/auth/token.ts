import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { SignJWT } from 'jose';

const API_AUDIENCE = 'laforja-api';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  const user = session?.user;

  if (!user?.googleId || !user.email) {
    return jsonError('unauthorized', 401);
  }

  // Ver auth.config.ts: process.env en runtime, import.meta.env en `astro dev`.
  const secret = process.env.AUTH_SECRET ?? import.meta.env.AUTH_SECRET;
  if (!secret) {
    console.error('AUTH_SECRET no está definida en apps/web');
    return jsonError('server_misconfigured', 500);
  }

  const key = new TextEncoder().encode(secret);

  const token = await new SignJWT({
    email: user.email,
    name: user.name ?? undefined,
    picture: user.image ?? undefined,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.googleId)
    .setAudience(API_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
};

function jsonError(code: string, status: number) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
