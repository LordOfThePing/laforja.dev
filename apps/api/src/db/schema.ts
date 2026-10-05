import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const subscriptionStatus = pgEnum('subscription_status', [
  'none',
  'active',
  'cancelled',
  'paused',
]);

// 'basic' = plan Oficial (3 desbloqueos/mes); 'pro' = plan Maestro (acceso total).
export const subscriptionPlan = pgEnum('subscription_plan', ['basic', 'pro']);

export const toolTier = pgEnum('tool_tier', ['free', 'premium']);

export const userRole = pgEnum('user_role', ['user', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  googleId: text('google_id').notNull().unique(),
  role: userRole('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  subscriptionStatus: subscriptionStatus('subscription_status').notNull().default('none'),
  subscriptionPlan: subscriptionPlan('subscription_plan'),
  subscriptionId: text('subscription_id'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  order: integer('order').notNull().default(0),
});

export const tools = pgTable('tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  shortDescription: text('short_description').notNull(),
  longDescription: text('long_description'),
  youtubeUrl: text('youtube_url'),
  promptBody: text('prompt_body'),
  tier: toolTier('tier').notNull().default('premium'),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  tags: text('tags').array().notNull().default([]),
  durationSeconds: integer('duration_seconds'),
  coverImageUrl: text('cover_image_url'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const unlocks = pgTable(
  'unlocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
    monthKey: text('month_key').notNull(),
  },
  (t) => [unique('unlocks_user_tool_month_uq').on(t.userId, t.toolId, t.monthKey)],
);

export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  mpEventId: text('mp_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  shortDescription: text('short_description').notNull(),
  description: text('description'),
  coverImageUrl: text('cover_image_url'),
  tier: toolTier('tier').notNull().default('premium'),
  order: integer('order').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    order: integer('order').notNull().default(0),
  },
  // Target de la FK compuesta de lessons: garantiza que lessons.course_id sea el del módulo.
  (t) => [unique('modules_id_course_uq').on(t.id, t.courseId)],
);

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moduleId: uuid('module_id').notNull(),
    // Denormalizado desde modules para poder exigir slug único por curso en la base.
    courseId: uuid('course_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    youtubeUrl: text('youtube_url'),
    contentMd: text('content_md'),
    durationSeconds: integer('duration_seconds'),
    order: integer('order').notNull().default(0),
    isFreePreview: boolean('is_free_preview').notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: 'lessons_module_course_fk',
      columns: [t.moduleId, t.courseId],
      foreignColumns: [modules.id, modules.courseId],
    }).onDelete('cascade'),
    unique('lessons_course_slug_uq').on(t.courseId, t.slug),
    index('lessons_module_idx').on(t.moduleId),
  ],
);

export const progress = pgTable(
  'progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    secondsWatched: integer('seconds_watched').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('progress_user_lesson_uq').on(t.userId, t.lessonId)],
);

// Se emite una vez y queda: si al curso después se le suman lecciones, el certificado sigue
// valiendo. El id es lo que se comparte (URL pública de verificación), por eso es un uuid.
export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    // Snapshot al emitir: el certificado dice lo que decía el día que se ganó.
    recipientName: text('recipient_name').notNull(),
    courseTitle: text('course_title').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('certificates_user_course_uq').on(t.userId, t.courseId)],
);

// Un registro por usuario y mes en que usó el sitio logueado: es la base de la retención en el
// panel. unlocks y progress no alcanzan (los suscriptores no desbloquean y progress solo guarda
// el último toque de cada lección).
export const userActivity = pgTable(
  'user_activity',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    monthKey: text('month_key').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.monthKey] }), index('user_activity_month_idx').on(t.monthKey)],
);

// Planos, sin respuestas anidadas: para v3 alcanza con una conversación por herramienta.
export const toolComments = pgTable(
  'tool_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tool_comments_tool_idx').on(t.toolId, t.createdAt),
    index('tool_comments_created_idx').on(t.createdAt),
  ],
);

// Rutas de aprendizaje: una secuencia curada de herramientas y cursos que ya existen.
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  shortDescription: text('short_description').notNull(),
  description: text('description'),
  coverImageUrl: text('cover_image_url'),
  order: integer('order').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const collectionItems = pgTable(
  'collection_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    // Un ítem es una herramienta o un curso, nunca los dos: lo garantiza el check.
    toolId: uuid('tool_id').references(() => tools.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),
    // Por qué este paso va en la ruta: lo que la diferencia de ver el catálogo suelto.
    note: text('note'),
    order: integer('order').notNull().default(0),
  },
  (t) => [
    check('collection_items_one_target', sql`num_nonnulls(${t.toolId}, ${t.courseId}) = 1`),
    unique('collection_items_tool_uq').on(t.collectionId, t.toolId),
    unique('collection_items_course_uq').on(t.collectionId, t.courseId),
    index('collection_items_collection_idx').on(t.collectionId, t.order),
  ],
);

export const newsletterStatus = pgEnum('newsletter_status', ['pending', 'confirmed', 'unsubscribed']);

// Doble opt-in: se entra como pending y solo el link del mail lo pasa a confirmed. El token es
// el mismo para confirmar y darse de baja (va en cada envío); se rota al volver a suscribirse.
export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Siempre en minúsculas: la unicidad es por dirección, no por cómo se tipeó.
  email: text('email').notNull().unique(),
  status: newsletterStatus('status').notNull().default('pending'),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
});

export const newsletterIssues = pgTable('newsletter_issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  // Si Resend falla a mitad de camino queda cuántos salieron, no los que se pensaba mandar.
  recipientCount: integer('recipient_count').notNull(),
  sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});
