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
});
