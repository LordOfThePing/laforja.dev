# Modelo de datos

Diseñado para v1 (herramientas + prompts) con hooks preparados para v2 (cursos/módulos).

## Tablas v1

### `users`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `email` | text unique | de Google |
| `name` | text | |
| `avatar_url` | text | |
| `google_id` | text unique | sub del token |
| `role` | enum | `user` / `admin`. Admin ve todo sin cupo y accede a `/admin` |
| `created_at` | timestamptz | |
| `subscription_status` | enum | `none` / `active` / `cancelled` / `paused` |
| `subscription_id` | text nullable | id de Preapproval de MP |
| `current_period_end` | timestamptz nullable | hasta cuándo tiene acceso |

### `tools`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text unique | para URLs |
| `title` | text | |
| `short_description` | text | público, para preview + SEO |
| `long_description` | text nullable | visible al desbloquear |
| `youtube_url` | text nullable | |
| `prompt_body` | text | el prompt en sí |
| `tier` | enum | `free` / `premium` |
| `category_id` | uuid fk → categories | |
| `tags` | text[] | |
| `duration_seconds` | int nullable | duración del video, para las cards |
| `cover_image_url` | text nullable | |
| `published_at` | timestamptz nullable | `null` o futura = no publicada |
| `created_at` | timestamptz | |

### `categories`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text unique | |
| `name` | text | |
| `description` | text | |
| `order` | int | orden en el nav |

### `unlocks`
Cada vez que un usuario abre una herramienta cuenta como unlock.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid fk → users | |
| `tool_id` | uuid fk → tools | |
| `unlocked_at` | timestamptz | |
| `month_key` | text | `YYYY-MM`, para query rápida |

**Unique constraint** `(user_id, tool_id, month_key)` — desbloquear la misma herramienta 2 veces en el mismo mes no cuenta doble.

### `subscription_events`
Historial de webhooks de MP para auditoría e idempotencia.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid fk → users nullable | |
| `mp_event_id` | text unique | idempotencia |
| `event_type` | text | |
| `payload` | jsonb | body crudo del webhook |
| `received_at` | timestamptz | |

## Tablas v2 (cursos — diseño anticipado)

- `courses` (id, slug, title, description, cover, tier, order, published_at)
- `modules` (id, course_id, title, description, order)
- `lessons` (id, module_id, title, youtube_url, content_md, order, duration_seconds)
- `progress` (id, user_id, lesson_id, completed_at, seconds_watched)

## Lógica de "2 gratis por mes"

**Insight importante**: no necesitamos cron. El reset mensual es automático porque `month_key` se deriva de la fecha actual.

```sql
-- ¿Puede el usuario X ver la herramienta Y?
SELECT
  CASE
    WHEN t.tier = 'free' THEN true
    WHEN u.subscription_status = 'active'
     AND (u.current_period_end IS NULL OR u.current_period_end > now())
     THEN true
    WHEN u.subscription_status = 'cancelled'
     AND u.current_period_end > now()
     THEN true
    WHEN (
      SELECT COUNT(DISTINCT tool_id)
      FROM unlocks
      WHERE user_id = u.id
        AND month_key = to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
    ) < 2 THEN true
    ELSE false
  END AS can_view
FROM users u, tools t
WHERE u.id = $1 AND t.id = $2;
```

El cron que mencionamos originalmente **no es necesario** — el "cupo mensual" se calcula sobre el mes en curso vía `month_key`, y al cambiar el mes el conteo naturalmente vuelve a cero.
