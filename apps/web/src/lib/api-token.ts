import type { Session } from '@auth/core/types';
import { SignJWT } from 'jose';
import { serverEnv } from './env';

const API_AUDIENCE = 'laforja-api';

export class MissingSecretError extends Error {
  constructor() {
    super('AUTH_SECRET no está definida en apps/web');
  }
}

// Contrato en docs/auth-y-pagos.md: la API solo acepta este JWT, no el de Auth.js.
export async function signApiToken(user: Session['user']): Promise<string | null> {
  if (!user?.googleId || !user.email) return null;

  const secret = serverEnv('AUTH_SECRET');
  if (!secret) throw new MissingSecretError();

  return new SignJWT({
    email: user.email,
    name: user.name ?? undefined,
    picture: user.image ?? undefined,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.googleId)
    .setAudience(API_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}
