import { and, asc, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  type AuthConfig,
  type AuthEnv,
  type AuthUser,
  type OptionalAuthEnv,
  optionalAuth,
  requireAuth,
} from '../auth.ts';
import type { Db } from '../db/client.ts';
import { categories, toolComments, tools, unlocks, users } from '../db/schema.ts';
import { hasFullAccess } from '../lib/access.ts';
import { isUuid } from '../lib/admin-input.ts';
import { parseCommentInput, publicAuthorName } from '../lib/comments.ts';
import { monthKey } from '../lib/month.ts';
import { type RateLimitRule, rateLimit } from '../lib/rate-limit.ts';
import {
  FREE_UNLOCKS_PER_MONTH,
  type Viewer,
  canView,
  quotaSummary,
  unlockedToolIds,
} from '../lib/unlocks.ts';

const previewColumns = {
  id: tools.id,
  slug: tools.slug,
  title: tools.title,
  shortDescription: tools.shortDescription,
  tier: tools.tier,
  tags: tools.tags,
  durationSeconds: tools.durationSeconds,
  coverImageUrl: tools.coverImageUrl,
  publishedAt: tools.publishedAt,
  category: {
    slug: categories.slug,
    name: categories.name,
  },
};

const detailColumns = {
  ...previewColumns,
  longDescription: tools.longDescription,
  youtubeUrl: tools.youtubeUrl,
  promptBody: tools.promptBody,
};

const isPublished = and(isNotNull(tools.publishedAt), lte(tools.publishedAt, sql`now()`));

function presentPreview<T extends { id: string }>({ id: _id, ...rest }: T, isLocked: boolean) {
  return { ...rest, isLocked };
}

function presentDetail<
  T extends { id: string; longDescription: unknown; youtubeUrl: unknown; promptBody: unknown },
>(row: T, viewable: boolean) {
  const { longDescription, youtubeUrl, promptBody, ...preview } = row;
  if (!viewable) return presentPreview(preview, true);
  return { ...presentPreview(preview, false), longDescription, youtubeUrl, promptBody };
}

// Tope de lectura: una herramienta con más comentarios que esto necesita paginado, no un
// payload gigante en cada vista.
const MAX_COMMENTS = 200;

const commentColumns = {
  id: toolComments.id,
  body: toolComments.body,
  createdAt: toolComments.createdAt,
  userId: toolComments.userId,
  authorName: users.name,
  authorAvatarUrl: users.avatarUrl,
};

type CommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  userId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
};

function presentComment(row: CommentRow, user: AuthUser | null) {
  const isMine = user?.id === row.userId;
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    author: { name: publicAuthorName(row.authorName), avatarUrl: row.authorAvatarUrl },
    isMine,
    canDelete: isMine || user?.role === 'admin',
  };
}

async function loadViewer(db: Db, user: Viewer['user']): Promise<Viewer> {
  if (!user) return { user: null, unlockedToolIds: new Set() };
  return { user, unlockedToolIds: await unlockedToolIds(db, user.id, monthKey()) };
}

export function toolsRoutes(auth: AuthConfig, unlockLimit: RateLimitRule, commentLimit: RateLimitRule) {
  const { db } = auth;
  const app = new Hono<OptionalAuthEnv>();

  function findPublished(slug: string) {
    return db
      .select(detailColumns)
      .from(tools)
      .innerJoin(categories, eq(tools.categoryId, categories.id))
      .where(and(eq(tools.slug, slug), isPublished))
      .limit(1)
      .then((rows) => rows[0]);
  }

  app.get('/', optionalAuth(auth), async (c) => {
    const viewer = await loadViewer(db, c.get('user'));
    const rows = await db
      .select(previewColumns)
      .from(tools)
      .innerJoin(categories, eq(tools.categoryId, categories.id))
      .where(isPublished)
      .orderBy(desc(tools.publishedAt), tools.slug);

    return c.json({
      tools: rows.map((row) => presentPreview(row, !canView(row, viewer))),
    });
  });

  app.get('/:slug', optionalAuth(auth), async (c) => {
    const row = await findPublished(c.req.param('slug'));
    if (!row) return c.json({ error: 'not_found' }, 404);

    const viewer = await loadViewer(db, c.get('user'));
    return c.json({ tool: presentDetail(row, canView(row, viewer)) });
  });

  app.post(
    '/:slug/unlock',
    requireAuth(auth),
    rateLimit<AuthEnv>(unlockLimit, (c) => c.get('user').id),
    async (c) => {
      const user = c.get('user');
      const row = await findPublished(c.req.param('slug'));
      if (!row) return c.json({ error: 'not_found' }, 404);

      const month = monthKey();
      const result = await db.transaction(async (tx) => {
        // Lock sobre la fila del usuario: sin esto, dos unlocks concurrentes de herramientas
        // distintas leen el mismo conteo y ambos pasan, dejando al usuario con 3 en el mes.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');

        const unlocked = await unlockedToolIds(tx, user.id, month);

        if (row.tier === 'free' || hasFullAccess(user) || unlocked.has(row.id)) {
          return { ok: true as const, used: unlocked.size, created: false };
        }
        if (unlocked.size >= FREE_UNLOCKS_PER_MONTH) {
          return { ok: false as const, used: unlocked.size };
        }

        await tx
          .insert(unlocks)
          .values({ userId: user.id, toolId: row.id, monthKey: month })
          .onConflictDoNothing();
        return { ok: true as const, used: unlocked.size + 1, created: true };
      });

      const quota = { monthKey: month, ...quotaSummary(result.used) };
      if (!result.ok) {
        return c.json({ error: 'quota_exceeded', unlocks: quota }, 403);
      }
      return c.json(
        { tool: presentDetail(row, true), unlocks: quota },
        result.created ? 201 : 200,
      );
    },
  );

  // Leer: cualquiera que pueda ver la herramienta. Escribir: solo quien tiene acceso completo
  // (suscriptores y admins); con el cupo gratis se lee pero no se comenta.
  app.get('/:slug/comments', optionalAuth(auth), async (c) => {
    const user = c.get('user');
    const row = await findPublished(c.req.param('slug'));
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (!canView(row, await loadViewer(db, user))) return c.json({ error: 'locked' }, 403);

    const rows = await db
      .select(commentColumns)
      .from(toolComments)
      .innerJoin(users, eq(toolComments.userId, users.id))
      .where(eq(toolComments.toolId, row.id))
      .orderBy(asc(toolComments.createdAt), asc(toolComments.id))
      .limit(MAX_COMMENTS);

    return c.json({
      comments: rows.map((r) => presentComment(r, user)),
      canComment: user !== null && hasFullAccess(user),
    });
  });

  app.post(
    '/:slug/comments',
    requireAuth(auth),
    rateLimit<AuthEnv>(commentLimit, (c) => c.get('user').id),
    async (c) => {
      const user = c.get('user');
      const row = await findPublished(c.req.param('slug'));
      if (!row) return c.json({ error: 'not_found' }, 404);
      if (!hasFullAccess(user)) return c.json({ error: 'subscription_required' }, 403);

      const body = parseCommentInput(await c.req.json().catch(() => null));
      if (body === null) return c.json({ error: 'invalid_body' }, 400);

      const [created] = await db
        .insert(toolComments)
        .values({ toolId: row.id, userId: user.id, body })
        .returning({ id: toolComments.id, body: toolComments.body, createdAt: toolComments.createdAt });
      const comment = presentComment(
        { ...created!, userId: user.id, authorName: user.name, authorAvatarUrl: user.avatarUrl },
        user,
      );
      return c.json({ comment }, 201);
    },
  );

  // Ajeno y no admin responde 404 igual que inexistente: no confirma ids de otros.
  app.delete('/:slug/comments/:id', requireAuth(auth), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);

    const [found] = await db
      .select({ userId: toolComments.userId })
      .from(toolComments)
      .innerJoin(tools, eq(toolComments.toolId, tools.id))
      .where(and(eq(toolComments.id, id), eq(tools.slug, c.req.param('slug'))))
      .limit(1);
    if (!found || (found.userId !== user.id && user.role !== 'admin')) {
      return c.json({ error: 'not_found' }, 404);
    }

    await db.delete(toolComments).where(eq(toolComments.id, id));
    return c.body(null, 204);
  });

  return app;
}
