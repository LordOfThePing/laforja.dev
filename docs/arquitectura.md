# Arquitectura

## Stack

Monorepo con dos apps:

- `apps/web` — Astro 5 + React islands (frontend)
- `apps/api` — Hono sobre Bun (backend REST)

Persistencia: Postgres 16 con Drizzle ORM.

## Diagrama

```
[Usuario] ─────────────┐
                       ▼
               Cloudflare (TLS) ══ tunnel ══> cloudflared ─┬─→ apps/web  (Astro SSR, :3000)   /api/auth/*, resto
                       ▲                                   │
[Webhook MercadoPago] ─┘                                   └─→ apps/api  (Hono, :4000)        /api/*, /webhooks/*
                                                                   │
                                                                   └─→ Postgres (:5432)

Todo lo que está a la derecha de `cloudflared` corre en el docker-compose del VPS.
```

## Decisiones y trade-offs

### ¿Por qué Astro?
- Landing y preview son contenido-first — renderizan estático o SSR ligero
- React islands solo donde hace falta interactividad (auth, dashboard, paywall)
- SEO fuerte para atraer tráfico orgánico a las herramientas

### ¿Por qué backend separado en vez de solo endpoints de Astro?
- Cuando llegue v2 con cursos, progreso y quizzes, la lógica se complica
- Habilita apps móviles o admin panel a futuro sin reescribir
- Webhooks de MP en un servicio dedicado son más limpios

### ¿Por qué Hono + Bun?
- Hono: framework mínimo, TypeScript nativo
- Bun: runtime + package manager + bundler en uno, arranque instantáneo
- Combo rápido y moderno para APIs REST

### ¿Por qué Drizzle en vez de Prisma?
- Sin paso de generación de código (más ágil)
- Schema en TypeScript puro
- Queries type-safe con sintaxis SQL-like
- Pairea nativo con Bun

### ¿Por qué Auth.js v5 en el frontend?
- Astro tiene integración oficial
- El frontend maneja el OAuth dance y emite un JWT propio
- El backend solo valida el JWT — menos complejidad de CORS

## Comunicación entre apps

- Frontend → backend: `fetch` con JWT en `Authorization: Bearer <token>`
- Backend valida JWT usando la misma `AUTH_SECRET`
- Backend → frontend: JSON REST

## Variables de entorno (esquema)

```env
# apps/web
AUTH_SECRET=xxx
AUTH_GOOGLE_ID=xxx
AUTH_GOOGLE_SECRET=xxx
API_URL=http://api:4000
PUBLIC_SITE_URL=https://academia.flynnpedroa.engineer

# apps/api
AUTH_SECRET=xxx                # misma que web
DATABASE_URL=postgres://laforja:xxx@postgres:5432/laforja
MP_ACCESS_TOKEN=xxx
MP_WEBHOOK_SECRET=xxx
FRONTEND_URL=https://academia.flynnpedroa.engineer
```
