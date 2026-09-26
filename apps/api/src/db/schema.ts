import {
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
