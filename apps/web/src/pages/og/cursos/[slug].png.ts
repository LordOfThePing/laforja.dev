import type { APIRoute } from 'astro';
import { formatLongDuration, getCourse } from '~/lib/api';
import { pngResponse, renderOgPng } from '~/lib/og';

export const GET: APIRoute = async ({ params, site }) => {
  const course = await getCourse(undefined, params.slug ?? '');
  if (!course) return new Response(null, { status: 404 });
  const lessons = course.modules.reduce((n, m) => n + m.lessons.length, 0);
  return pngResponse(
    await renderOgPng({
      eyebrow: `Curso · ${lessons} lecciones · ${formatLongDuration(course.durationSeconds)}`,
      title: course.title,
      description: course.shortDescription,
      footer: `${new URL(site!).host}/cursos`,
    }),
  );
};
