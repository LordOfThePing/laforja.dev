import { and, asc, desc, eq, max, ne, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { AuthEnv } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { collectionItems, collections, courses, tools } from '../db/schema.ts';
import {
  isUuid,
  parseCollection,
  parseCollectionItem,
  parseCollectionItemNote,
  parseDirection,
} from '../lib/admin-input.ts';
import { reorder } from './admin-courses.ts';

const collectionColumns = {
  id: collections.id,
  slug: collections.slug,
  title: collections.title,
  shortDescription: collections.shortDescription,
  description: collections.description,
  coverImageUrl: collections.coverImageUrl,
  order: collections.order,
  publishedAt: collections.publishedAt,
  createdAt: collections.createdAt,
};

async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

function invalid(c: Context, field: string) {
  return c.json({ error: 'invalid_input', field }, 400);
}

const notFound = (c: Context) => c.json({ error: 'not_found' }, 404);

export function adminCollectionRoutes(db: Db) {
  const app = new Hono<AuthEnv>();

  async function slugTaken(slug: string, exceptId?: string) {
    const [row] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(exceptId ? and(eq(collections.slug, slug), ne(collections.id, exceptId)) : eq(collections.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  app.get('/collections', async (c) => {
    const rows = await db
      .select({
        ...collectionColumns,
        // Drizzle no califica columnas en un select de una sola tabla (ver admin-courses.ts).
        itemCount: sql<number>`(select count(*) from ${collectionItems} i where i.collection_id = ${collections}.id)`.mapWith(Number),
      })
      .from(collections)
      .orderBy(asc(collections.order), desc(collections.createdAt));
    return c.json({ collections: rows });
  });

  app.post('/collections', async (c) => {
    const parsed = parseCollection(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    if (await slugTaken(parsed.value.slug)) return c.json({ error: 'slug_taken' }, 409);
    const [row] = await db.insert(collections).values(parsed.value).returning(collectionColumns);
    return c.json({ collection: row }, 201);
  });

  app.get('/collections/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const [collection] = await db.select(collectionColumns).from(collections).where(eq(collections.id, id));
    if (!collection) return notFound(c);

    const items = await db
      .select({
        id: collectionItems.id,
        note: collectionItems.note,
        toolId: collectionItems.toolId,
        courseId: collectionItems.courseId,
        title: sql<string>`coalesce(${tools.title}, ${courses.title})`,
        slug: sql<string>`coalesce(${tools.slug}, ${courses.slug})`,
        publishedAt: sql<string | null>`coalesce(${tools.publishedAt}, ${courses.publishedAt})`,
      })
      .from(collectionItems)
      .leftJoin(tools, eq(collectionItems.toolId, tools.id))
      .leftJoin(courses, eq(collectionItems.courseId, courses.id))
      .where(eq(collectionItems.collectionId, id))
      .orderBy(asc(collectionItems.order), asc(collectionItems.id));

    return c.json({
      collection: {
        ...collection,
        items: items.map(({ toolId, courseId, ...item }) => ({
          ...item,
          kind: toolId ? ('tool' as const) : ('course' as const),
          targetId: (toolId ?? courseId) as string,
        })),
      },
    });
  });

  app.patch('/collections/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const parsed = parseCollection(await readJson(c), true);
    if (!parsed.ok) return invalid(c, parsed.field);
    const input = parsed.value;
    if (Object.keys(input).length === 0) return invalid(c, 'body');
    if (input.slug && (await slugTaken(input.slug, id))) return c.json({ error: 'slug_taken' }, 409);
    const [row] = await db.update(collections).set(input).where(eq(collections.id, id)).returning(collectionColumns);
    if (!row) return notFound(c);
    return c.json({ collection: row });
  });

  app.delete('/collections/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const [row] = await db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id });
    if (!row) return notFound(c);
    return c.body(null, 204);
  });

  app.post('/collections/:id/items', async (c) => {
    const collectionId = c.req.param('id');
    if (!isUuid(collectionId)) return notFound(c);
    const parsed = parseCollectionItem(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    const input = parsed.value;

    const [collection] = await db.select({ id: collections.id }).from(collections).where(eq(collections.id, collectionId));
    if (!collection) return notFound(c);

    const [target] =
      'toolId' in input
        ? await db.select({ id: tools.id }).from(tools).where(eq(tools.id, input.toolId))
        : await db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.courseId));
    if (!target) return invalid(c, 'toolId' in input ? 'toolId' : 'courseId');

    const [taken] = await db
      .select({ id: collectionItems.id })
      .from(collectionItems)
      .where(
        and(
          eq(collectionItems.collectionId, collectionId),
          'toolId' in input ? eq(collectionItems.toolId, input.toolId) : eq(collectionItems.courseId, input.courseId),
        ),
      );
    if (taken) return c.json({ error: 'item_taken' }, 409);

    const [last] = await db
      .select({ n: max(collectionItems.order) })
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, collectionId));
    const [row] = await db
      .insert(collectionItems)
      .values({ ...input, collectionId, order: (last?.n ?? 0) + 1 })
      .returning();
    return c.json({ item: row }, 201);
  });

  app.patch('/collection-items/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const parsed = parseCollectionItemNote(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    const [row] = await db.update(collectionItems).set(parsed.value).where(eq(collectionItems.id, id)).returning();
    if (!row) return notFound(c);
    return c.json({ item: row });
  });

  app.delete('/collection-items/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const [row] = await db.delete(collectionItems).where(eq(collectionItems.id, id)).returning({ id: collectionItems.id });
    if (!row) return notFound(c);
    return c.body(null, 204);
  });

  app.post('/collection-items/:id/move', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);
    const direction = parseDirection(await readJson(c));
    if (!direction) return invalid(c, 'direction');
    const [item] = await db
      .select({ collectionId: collectionItems.collectionId })
      .from(collectionItems)
      .where(eq(collectionItems.id, id));
    if (!item) return notFound(c);

    await db.transaction(async (tx) => {
      const siblings = await tx
        .select({ id: collectionItems.id })
        .from(collectionItems)
        .where(eq(collectionItems.collectionId, item.collectionId))
        .orderBy(asc(collectionItems.order), asc(collectionItems.id))
        .for('update');
      const next = reorder(siblings.map((s) => s.id), id, direction);
      if (!next) return;
      for (const [i, sid] of next.entries()) {
        await tx.update(collectionItems).set({ order: i + 1 }).where(eq(collectionItems.id, sid));
      }
    });
    return c.body(null, 204);
  });

  return app;
}
