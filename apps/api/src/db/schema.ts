import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const subscriptionStatus = pgEnum('subscription_status', [
  'none',
  'active',
  'cancelled',
  'paused',
]);

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
  promptBody: text('prompt_body').notNull(),
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
