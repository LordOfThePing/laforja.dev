import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { MissingSecretError, signApiToken } from '~/lib/api-token';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);

  let token: string | null;
  try {
    token = await signApiToken(session?.user);
  } catch (err) {
    if (!(err instanceof MissingSecretError)) throw err;
    console.error(err.message);
    return jsonError('server_misconfigured', 500);
  }
  if (!token) return jsonError('unauthorized', 401);

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
