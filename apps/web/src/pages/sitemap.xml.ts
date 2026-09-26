import type { APIRoute } from 'astro';
import { listCourses, listTools } from '~/lib/api';

const STATIC_PATHS = ['/', '/cursos', '/suscripcion', '/terminos', '/privacidad'];

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async ({ site }) => {
  let tools;
  let courses;
  try {
    [tools, courses] = await Promise.all([listTools(undefined), listCourses(undefined)]);
  } catch (err) {
    console.error('No se pudo armar el sitemap', err);
    // Un sitemap sin las herramientas le diría al crawler que desaparecieron; mejor que reintente.
    return new Response(null, { status: 503, headers: { 'retry-after': '3600' } });
  }

  const urls = [
    ...STATIC_PATHS.map((path) => ({ loc: new URL(path, site).href, lastmod: null as string | null })),
    ...tools.map((t) => ({
      loc: new URL(`/herramientas/${encodeURIComponent(t.slug)}`, site).href,
      lastmod: t.publishedAt.slice(0, 10),
    })),
    ...courses.map((c) => ({
      loc: new URL(`/cursos/${encodeURIComponent(c.slug)}`, site).href,
      lastmod: c.publishedAt.slice(0, 10),
    })),
  ];

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
      )
      .join('\n') +
    '\n</urlset>\n';

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
