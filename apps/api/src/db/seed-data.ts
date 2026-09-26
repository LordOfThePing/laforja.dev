import { eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { categories, courses, lessons, modules, tools } from './schema.ts';

type SeedCategory = typeof categories.$inferInsert;
type SeedTool = Omit<typeof tools.$inferInsert, 'categoryId' | 'publishedAt'> & {
  categorySlug: string;
};

export const seedCategories: SeedCategory[] = [
  { slug: 'prompts', name: 'Prompts', description: 'Prompts listos para usar y adaptar.', order: 1 },
  { slug: 'agentes', name: 'Agentes', description: 'Agentes que trabajan por vos.', order: 2 },
  { slug: 'workflows', name: 'Workflows', description: 'Flujos de punta a punta con IA.', order: 3 },
];

// Mismo orden que el mock de apps/web: el primero es el más reciente.
export const seedTools: SeedTool[] = [
  {
    slug: 'meta-prompt-arquitecto',
    title: 'Meta-prompt del arquitecto',
    shortDescription:
      'Un prompt maestro para que el agente diseñe la arquitectura antes de escribir una sola línea.',
    categorySlug: 'prompts',
    tier: 'free',
    tags: ['arquitectura', 'planificación'],
    durationSeconds: 8 * 60,
    promptBody:
      'Antes de escribir código, actuá como arquitecto de software. Describí los componentes, sus responsabilidades, los datos que fluyen entre ellos y los riesgos principales. No escribas código hasta que confirme el diseño.',
  },
  {
    slug: 'agente-investigador',
    title: 'Agente investigador de mercado',
    shortDescription:
      'Cómo montar un agente que investiga competencia y arma un reporte accionable en 10 minutos.',
    categorySlug: 'agentes',
    tier: 'free',
    tags: ['research', 'competencia'],
    durationSeconds: 14 * 60,
    promptBody:
      'Investigá a los 5 competidores principales de <producto>. Para cada uno: propuesta de valor, precio, canales de adquisición y una debilidad explotable. Cerrá con 3 acciones concretas para nosotros.',
  },
  {
    slug: 'workflow-triage-tickets',
    title: 'Triage automático de tickets',
    shortDescription:
      'Workflow que clasifica, prioriza y asigna tickets nuevos usando un agente y reglas de negocio.',
    categorySlug: 'workflows',
    tier: 'premium',
    tags: ['productividad', 'automatización'],
    durationSeconds: 22 * 60,
    promptBody:
      'Clasificá el ticket en una de estas categorías: <categorías>. Asigná prioridad P0–P3 según estas reglas: <reglas>. Devolvé JSON con categoría, prioridad, responsable sugerido y una línea de justificación.',
  },
  {
    slug: 'code-review-agentico',
    title: 'Code review agéntico',
    shortDescription:
      'Un pipeline que hace review de PRs con estándares específicos de tu equipo antes que un humano.',
    categorySlug: 'agentes',
    tier: 'premium',
    tags: ['dev', 'code review'],
    durationSeconds: 19 * 60,
    promptBody:
      'Revisá este diff contra los estándares del equipo: <estándares>. Reportá solo problemas reales (bugs, violaciones de estándar, riesgos de seguridad), cada uno con archivo, línea y un fix sugerido. Nada de nitpicks de estilo.',
  },
  {
    slug: 'prompt-editorial',
    title: 'Prompt editorial de largo aliento',
    shortDescription:
      'Estructura para generar contenido largo con voz consistente y sin caer en el tono genérico de LLM.',
    categorySlug: 'prompts',
    tier: 'premium',
    tags: ['contenido', 'escritura'],
    durationSeconds: 11 * 60,
    promptBody:
      'Escribí con esta voz: <3 ejemplos de textos propios>. Prohibido: frases de relleno, listas innecesarias, cierres motivacionales. Primero proponé un índice; escribí sección por sección solo cuando lo apruebe.',
  },
  {
    slug: 'sub-agentes-especializados',
    title: 'Sub-agentes especializados',
    shortDescription:
      'Patrón para descomponer tareas complejas en sub-agentes con roles claros que se coordinan entre sí.',
    categorySlug: 'agentes',
    tier: 'premium',
    tags: ['patrones', 'arquitectura'],
    durationSeconds: 26 * 60,
    promptBody:
      'Descomponé la tarea en sub-tareas independientes. Para cada una definí: rol del sub-agente, input exacto, output esperado y criterio de éxito. Después coordiná los resultados y resolvé conflictos entre ellos.',
  },
  {
    slug: 'prompt-debug',
    title: 'Prompt para debug quirúrgico',
    shortDescription:
      'Cómo pedirle a un agente que encuentre root causes en vez de parchar síntomas.',
    categorySlug: 'prompts',
    tier: 'premium',
    tags: ['dev', 'debug'],
    durationSeconds: 9 * 60,
    promptBody:
      'No propongas un fix todavía. Formulá hipótesis sobre la causa raíz, ordenadas por probabilidad, y para cada una el experimento mínimo que la confirma o descarta. Solo cuando una quede confirmada, proponé el fix.',
  },
  {
    slug: 'evaluar-outputs',
    title: 'Framework para evaluar outputs',
    shortDescription:
      'Cómo medir si un agente está haciendo bien su trabajo, en vez de "me parece que sí".',
    categorySlug: 'workflows',
    tier: 'premium',
    tags: ['evals', 'calidad'],
    durationSeconds: 17 * 60,
    promptBody:
      'Definí 5 criterios observables para evaluar este output: <tarea>. Para cada criterio, una escala 1–3 con ejemplos concretos de cada nivel. Después puntuá el output y justificá cada puntaje en una línea.',
  },
];

type SeedLesson = Omit<typeof lessons.$inferInsert, 'moduleId' | 'courseId' | 'order'>;
type SeedCourse = Omit<typeof courses.$inferInsert, 'publishedAt'> & {
  modules: { title: string; description?: string; lessons: SeedLesson[] }[];
};

export const seedCourses: SeedCourse[] = [
  {
    slug: 'agentes-de-punta-a-punta',
    title: 'Agentes de punta a punta',
    shortDescription:
      'De un prompt suelto a un agente que planifica, usa herramientas y se evalúa solo.',
    description:
      'Un recorrido práctico para pasar de pedirle cosas a un chat a diseñar agentes que trabajan por vos. Cada lección cierra con algo que podés usar el mismo día.',
    tier: 'premium',
    order: 1,
    modules: [
      {
        title: 'Fundamentos',
        description: 'Qué es un agente y cuándo conviene usar uno.',
        lessons: [
          {
            slug: 'que-es-un-agente',
            title: 'Qué es (y qué no es) un agente',
            durationSeconds: 7 * 60,
            isFreePreview: true,
            contentMd: 'Un agente es un loop: decide, actúa, observa y vuelve a decidir.',
          },
          {
            slug: 'planificar-antes-de-actuar',
            title: 'Planificar antes de actuar',
            durationSeconds: 12 * 60,
            contentMd: 'Pedile un plan explícito antes de dejarlo tocar nada.',
          },
        ],
      },
      {
        title: 'En producción',
        lessons: [
          {
            slug: 'herramientas-y-permisos',
            title: 'Herramientas y permisos',
            durationSeconds: 15 * 60,
            contentMd: 'Cada herramienta que le das es una superficie de error: empezá por las de solo lectura.',
          },
          {
            slug: 'evaluar-al-agente',
            title: 'Evaluar al agente',
            durationSeconds: 18 * 60,
            contentMd: 'Sin evals, cada cambio de prompt es una apuesta.',
          },
        ],
      },
    ],
  },
  {
    slug: 'prompting-desde-cero',
    title: 'Prompting desde cero',
    shortDescription: 'Lo mínimo indispensable para dejar de pelearte con el chat.',
    tier: 'free',
    order: 2,
    modules: [
      {
        title: 'Lo básico',
        lessons: [
          {
            slug: 'contexto-primero',
            title: 'Contexto primero',
            durationSeconds: 6 * 60,
            contentMd: 'El modelo no sabe nada de tu proyecto hasta que se lo contás.',
          },
          {
            slug: 'ejemplos-que-ensenan',
            title: 'Ejemplos que enseñan',
            durationSeconds: 8 * 60,
            contentMd: 'Dos buenos ejemplos valen más que diez adjetivos.',
          },
        ],
      },
    ],
  },
];

async function seedCourse(db: Db, { modules: mods, ...course }: SeedCourse, publishedAt: Date) {
  const [row] = await db
    .insert(courses)
    .values({ ...course, publishedAt })
    .onConflictDoUpdate({
      target: courses.slug,
      set: {
        title: sql`excluded.title`,
        shortDescription: sql`excluded.short_description`,
        description: sql`excluded.description`,
        tier: sql`excluded.tier`,
        order: sql`excluded.order`,
      },
    })
    .returning({ id: courses.id });
  if (!row) throw new Error(`El upsert del curso ${course.slug} no devolvió fila`);

  // Los módulos no tienen clave natural para hacer upsert, y borrarlos arrastraría en cascada
  // el progreso de los alumnos. Así que el temario se siembra una sola vez por curso.
  const existing = await db.select({ id: modules.id }).from(modules).where(eq(modules.courseId, row.id)).limit(1);
  if (existing.length > 0) return;

  for (const [m, mod] of mods.entries()) {
    const [modRow] = await db
      .insert(modules)
      .values({ courseId: row.id, title: mod.title, description: mod.description, order: m + 1 })
      .returning({ id: modules.id });
    if (!modRow) throw new Error(`No se pudo crear el módulo ${mod.title}`);
    await db.insert(lessons).values(
      mod.lessons.map((lesson, l) => ({ ...lesson, moduleId: modRow.id, courseId: row.id, order: l + 1 })),
    );
  }
}

export async function seed(db: Db) {
  await db
    .insert(categories)
    .values(seedCategories)
    .onConflictDoUpdate({
      target: categories.slug,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        order: sql`excluded.order`,
      },
    });

  const categoryRows = await db.select({ id: categories.id, slug: categories.slug }).from(categories);
  const categoryIds = new Map(categoryRows.map((c) => [c.slug, c.id]));

  const now = Date.now();
  const values = seedTools.map(({ categorySlug, ...tool }, i) => {
    const categoryId = categoryIds.get(categorySlug);
    if (!categoryId) throw new Error(`Categoría inexistente en el seed: ${categorySlug}`);
    return { ...tool, categoryId, publishedAt: new Date(now - i * 60_000) };
  });

  await db
    .insert(tools)
    .values(values)
    .onConflictDoUpdate({
      target: tools.slug,
      set: {
        title: sql`excluded.title`,
        shortDescription: sql`excluded.short_description`,
        promptBody: sql`excluded.prompt_body`,
        tier: sql`excluded.tier`,
        categoryId: sql`excluded.category_id`,
        tags: sql`excluded.tags`,
        durationSeconds: sql`excluded.duration_seconds`,
        publishedAt: sql`excluded.published_at`,
      },
    });

  for (const [i, course] of seedCourses.entries()) {
    await seedCourse(db, course, new Date(now - i * 60_000));
  }
}
