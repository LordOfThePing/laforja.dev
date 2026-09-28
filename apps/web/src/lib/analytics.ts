import type { APIContext } from 'astro';
import { serverEnv } from './env';

// Pageviews a Umami desde el servidor: sin script en el browser, sin cookies y sin tocar la CSP.
// Umami arma el visitante con IP + user-agent + un salt que rota, así que no hay identificador
// persistente. Ver "Analytics" en docs/despliegue-vps.md.

const SKIP_PREFIXES = ['/admin', '/api/', '/og/', '/og.png', '/_astro/', '/_image'];
const SKIP_PATHS = new Set(['/robots.txt', '/sitemap.xml']);

function shouldTrack(context: APIContext, response: Response): boolean {
  const { request, url } = context;
  if (request.method !== 'GET' || response.status !== 200) return false;
  if (!response.headers.get('content-type')?.startsWith('text/html')) return false;
  // Los prefetch de Astro y de Chrome no son visitas.
  if (request.headers.get('sec-purpose')?.includes('prefetch')) return false;
  if (request.headers.get('purpose') === 'prefetch') return false;
  if (SKIP_PATHS.has(url.pathname)) return false;
  return !SKIP_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

// Solo se mandan los utm_*: el resto del query puede traer ids de MP u otros datos.
function trackedUrl(url: URL): string {
  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith('utm_')) params.append(key, value);
  }
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

// Entre páginas del sitio el browser manda la URL entera como referer, query incluido.
function referrerWithoutQuery(referer: string | null): string | undefined {
  if (!referer) return undefined;
  try {
    const { origin, pathname } = new URL(referer);
    return origin + pathname;
  } catch {
    return undefined;
  }
}

export function trackPageview(context: APIContext, response: Response): void {
  const endpoint = serverEnv('UMAMI_URL');
  const website = serverEnv('UMAMI_WEBSITE_ID');
  if (!endpoint || !website || !shouldTrack(context, response)) return;

  const { request, url } = context;
  const userAgent = request.headers.get('user-agent');
  if (!userAgent) return;

  // Umami toma IP y país de estos headers (los pone Cloudflare); sin IP no geolocaliza.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': userAgent,
  };
  for (const name of ['cf-connecting-ip', 'cf-ipcountry']) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const referrer = referrerWithoutQuery(request.headers.get('referer'));
  const language = request.headers.get('accept-language')?.split(',')[0]?.trim() ?? '';

  fetch(new URL('/api/send', endpoint), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'event',
      payload: {
        website,
        hostname: url.hostname,
        url: trackedUrl(url),
        language,
        ...(referrer && { referrer }),
      },
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {
    // Si Umami no está o no responde, la página no se entera.
  });
}
