import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import auth from 'auth-astro';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), auth()],
  server: { port: 3000, host: true },
  site: 'https://academia.flynnpedroa.engineer',
});
