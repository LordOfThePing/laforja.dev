import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import auth from 'auth-astro';

const site = 'https://academia.flynnpedroa.engineer';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), auth()],
  server: { port: 3000, host: true },
  site,
  security: {
    // Sin allowedDomains, Astro ignora el Host y arma la URL como `localhost`, así que el
    // checkOrigin rechaza con 403 todo POST que llega por el tunnel (incluido el signin de Auth.js).
    allowedDomains: [{ protocol: 'https', hostname: new URL(site).hostname }, { hostname: 'localhost' }],
  },
  experimental: {
    // Astro arma la CSP con los hashes de los scripts/estilos inline de cada página.
    // frame-ancestors y el resto de los headers de seguridad los agrega src/middleware.ts.
    csp: {
      styleDirective: { resources: ["'self'", 'https://fonts.googleapis.com'] },
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https://*.googleusercontent.com",
        'font-src https://fonts.gstatic.com',
        'frame-src https://www.youtube-nocookie.com',
        "object-src 'none'",
        "base-uri 'self'",
        // Chrome aplica form-action también a los redirects: /suscripcion responde 303 al checkout de MP.
        "form-action 'self' https://*.mercadopago.com.ar https://*.mercadopago.com",
      ],
    },
  },
});
