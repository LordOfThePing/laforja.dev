# Modelo de datos

v1 (herramientas + prompts) y v2 (cursos → módulos → lecciones, con progreso).

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

## Tablas v2 (cursos)

### `courses`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text unique | |
| `title` | text | |
| `short_description` | text | para cards y SEO |
| `description` | text nullable | texto largo de la landing del curso |
| `cover_image_url` | text nullable | |
| `tier` | enum `tool_tier` | `free` / `premium` (mismo enum que `tools`) |
| `order` | int | orden en `/cursos` |
| `published_at` | timestamptz nullable | `null` o futura = no publicado |
| `created_at` | timestamptz | |

### `modules`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `course_id` | uuid fk → courses | `on delete cascade` |
| `title` | text | |
| `description` | text nullable | |
| `order` | int | |

**Unique** `(id, course_id)`: solo existe para ser target de la FK compuesta de `lessons`.

### `lessons`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `module_id` | uuid | |
| `course_id` | uuid | denormalizado; **FK compuesta** `(module_id, course_id)` → `modules(id, course_id)` garantiza que coincida con el del módulo |
| `slug` | text | **unique `(course_id, slug)`**: URLs `/cursos/:curso/:leccion` |
| `title` | text | |
| `youtube_url` | text nullable | |
| `content_md` | text nullable | |
| `duration_seconds` | int nullable | |
| `order` | int | dentro del módulo |
| `is_free_preview` | bool | abierta a todos aunque el curso sea premium |

### `progress`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid fk → users | `on delete cascade` |
| `lesson_id` | uuid fk → lessons | `on delete cascade` |
| `seconds_watched` | int | solo sube (`greatest`) |
| `completed_at` | timestamptz nullable | primera vez que se completó |
| `updated_at` | timestamptz | |

**Unique** `(user_id, lesson_id)`.

### Acceso a cursos

Los cursos **no** usan el cupo de unlocks: la suscripción abre todo (roadmap v2).
Una lección se ve si el curso es `free`, si la lección es `is_free_preview`, o si el usuario
tiene suscripción vigente / es admin. El temario (títulos, duraciones) es siempre público.

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
