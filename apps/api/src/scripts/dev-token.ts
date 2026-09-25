import { sign } from 'hono/jwt';
import { JWT_AUDIENCE } from '../auth.ts';

// Para probar la API sin levantar el login de la web: bun run token:dev [email]
const email = process.argv[2] ?? 'dev@laforja.dev';
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error('Falta la variable de entorno AUTH_SECRET');

const token = await sign(
  {
    sub: `dev-${email}`,
    email,
    name: email.split('@')[0],
    aud: JWT_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
  secret,
  'HS256',
);
console.log(token);
