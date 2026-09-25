import Google from '@auth/core/providers/google';
import { defineConfig } from 'auth-astro';

// Vite reemplaza import.meta.env.* privadas en el build, así que en la imagen de Docker
// quedarían undefined. process.env se lee en runtime; import.meta.env cubre `astro dev`.
const env = (name: string): string | undefined => process.env[name] ?? import.meta.env[name];

export default defineConfig({
  secret: env('AUTH_SECRET'),
  // Detrás de Cloudflare Tunnel el Host lo pone el proxy; sin esto Auth.js rechaza el request.
  trustHost: true,
  providers: [
    Google({
      clientId: env('AUTH_GOOGLE_ID'),
      clientSecret: env('AUTH_GOOGLE_SECRET'),
    }),
  ],
  callbacks: {
    // Guardamos el `sub` de Google en el token propio de Auth.js para poder
    // firmar despues el JWT que consume nuestra API (ver auth-y-pagos.md).
    async jwt({ token, account, profile }) {
      if (account?.provider === 'google' && typeof profile?.sub === 'string') {
        token.googleId = profile.sub;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.googleId === 'string' && session.user) {
        session.user.googleId = token.googleId;
      }
      return session;
    },
  },
});
