import { defineMiddleware } from 'astro:middleware';
import { trackPageview } from './lib/analytics';

// El grueso de la CSP lo arma Astro con los hashes de cada página (experimental.csp en
// astro.config.mjs); acá solo se le suma frame-ancestors, que Astro no deja configurar.
const FRAME_ANCESTORS = "frame-ancestors 'none'";

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  // no-referrer rompe el embed de YouTube (error 153): necesita al menos el origin.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  trackPageview(context, response);
  const csp = response.headers.get('Content-Security-Policy');
  response.headers.set(
    'Content-Security-Policy',
    csp ? `${csp.trim().replace(/;$/, '')}; ${FRAME_ANCESTORS}` : FRAME_ANCESTORS,
  );
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  return response;
});
