import type { APIRoute } from 'astro';
import { pngResponse, renderOgPng } from '~/lib/og';

export const GET: APIRoute = async ({ site }) =>
  pngResponse(
    await renderOgPng({
      eyebrow: 'Academia de herramientas agénticas',
      title: 'Prompts, agentes y workflows curados.',
      description: 'Probados, refinados y usados todos los días. Sin humo.',
      footer: new URL(site!).host,
    }),
  );
