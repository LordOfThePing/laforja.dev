# La Forja

Academia de herramientas y prompts para trabajar con agentes de IA. Videos de YouTube + prompts curados, con acceso freemium.

**Dominio actual (transición)**: `academia.flynnpedroa.engineer`
**Dominio futuro**: `laforja.dev`

---

## Idea en una línea

Una biblioteca curada de herramientas agénticas donde cada usuario puede desbloquear **2 recursos gratis por mes**, y una suscripción de **4.000 ARS/mes** vía MercadoPago habilita acceso ilimitado.

## Estado

- ✅ Docs de referencia (arquitectura, schema, auth, pagos, deploy, roadmap, brief de diseño)
- ✅ Bootstrap del frontend (`apps/web`, Astro 5 + React) con landing lista para iterar
- ✅ Bootstrap del backend (`apps/api`, Hono + Bun) con endpoints públicos de herramientas
- ✅ Schema v1 en Drizzle + migración inicial + seed
- ✅ Validación de JWT en la API + `GET /api/me`
- ⏳ Auth.js con Google en la web — pendiente
- ✅ Unlocks con cupo de 2/mes
- ✅ Integración MP Preapproval + webhooks en la API (sin probar contra MP real)
- ✅ Docker Compose (postgres + migrate + api + web)
- ⏳ Deploy en VPS (Hetzner + Cloudflare Tunnel) — pendiente

## Stack

- **Frontend**: Astro 5 + React islands
- **Backend**: Hono sobre Bun
- **ORM / DB**: Drizzle + Postgres 16
- **Auth**: Auth.js v5 (solo Google) + JWT
- **Pagos**: MercadoPago Preapproval + webhook
- **Deploy**: Docker Compose en VPS detrás de Nginx

## Cómo correr el frontend (una vez tengas Bun instalado)

```bash
cd apps/web
bun install
bun run dev
# → http://localhost:3000
```

## Cómo correr el backend

Necesitás un Postgres 16 accesible (ver `apps/api/.env.example`).

```bash
cd apps/api
bun install
cp .env.example .env      # ajustá DATABASE_URL
bun run db:migrate        # aplica las migraciones
bun run db:seed           # carga categorías + herramientas de ejemplo
bun run dev
# → http://localhost:4000/health

bun run token:dev         # token para probar endpoints autenticados
```

Tests (usan PGlite en memoria, no necesitan Postgres): `bun test`.

## Cómo correr todo con Docker

```bash
cp .env.example .env      # completá los valores
docker compose up -d --build --wait
docker compose run --rm api bun run db:seed
# web → http://localhost:3000 · api → http://localhost:4000/health
```

## Documentos de referencia

| Doc | Contenido |
|---|---|
| [arquitectura.md](docs/arquitectura.md) | Stack detallado, diagrama, decisiones |
| [schema-datos.md](docs/schema-datos.md) | Modelo de datos (v1 + hooks para cursos futuros) |
| [auth-y-pagos.md](docs/auth-y-pagos.md) | Flujo Google OAuth + MP Preapproval + webhooks |
| [despliegue-vps.md](docs/despliegue-vps.md) | Docker Compose, Nginx, DNS, HTTPS |
| [roadmap.md](docs/roadmap.md) | Fases v1 → v2 → v3 |
| [diseño-brief.md](docs/diseño-brief.md) | Brief para `/design-shotgun` |

## Estructura

```
academy/
├── apps/
│   ├── api/               # Hono + Bun + Drizzle (REST)
│   │   ├── drizzle/        # migraciones generadas
│   │   └── src/
│   │       ├── db/         # schema, cliente, seed
│   │       └── routes/
│   └── web/               # Astro + React (landing, dashboard, auth)
│       ├── src/
│       │   ├── components/
│       │   ├── data/       # mock data por ahora, luego API real
│       │   ├── layouts/
│       │   ├── pages/
│       │   └── styles/
│       ├── astro.config.mjs
│       └── package.json
├── docs/                  # documentos de referencia
└── README.md
```
