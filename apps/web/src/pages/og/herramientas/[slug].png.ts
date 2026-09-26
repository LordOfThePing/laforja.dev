import type { APIRoute } from 'astro';
import { getTool } from '~/lib/api';
import { pngResponse, renderOgPng } from '~/lib/og';

export const GET: APIRoute = async ({ params, site }) => {
  const tool = await getTool(undefined, params.slug ?? '');
  if (!tool) return new Response(null, { status: 404 });
  const tier = tool.tier === 'free' ? 'Gratis' : 'Premium';
  return pngResponse(
    await renderOgPng({
      eyebrow: `${tool.category.name} · ${tier}`,
      title: tool.title,
      description: tool.shortDescription,
      footer: `${new URL(site!).host}/herramientas`,
    }),
  );
};
