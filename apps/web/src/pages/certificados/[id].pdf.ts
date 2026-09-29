import type { APIRoute } from 'astro';
import { fetchCertificatePdf } from '~/lib/api';

// Pasa por la web y no se linkea /api/certificates/:id/pdf directo: en local la api está en
// otro puerto, y así el link es el mismo en todos lados.
export const GET: APIRoute = async ({ params }) => {
  const res = await fetchCertificatePdf(params.id ?? '');
  if (res.status === 404) return new Response(null, { status: 404 });
  if (!res.ok) return new Response('No pudimos generar el PDF. Probá de nuevo en un rato.', { status: 503 });

  const headers = new Headers({ 'content-type': 'application/pdf' });
  for (const name of ['content-disposition', 'cache-control']) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: 200, headers });
};
