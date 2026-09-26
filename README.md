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
- ✅ Auth.js con Google en la web
- ✅ Web conectada a la API real (catálogo, detalle `/herramientas/:slug`, desbloqueo)
- ✅ Dashboard (`/dashboard`) y flujo de suscripción en la web (`/suscripcion` → MP → `/dashboard/gracias`)
- ✅ Unlocks con cupo de 2/mes
- ✅ Integración MP Preapproval + webhooks en la API (sin probar contra MP real)
- ✅ Docker Compose (postgres + migrate + api + web)
- ✅ Deploy en VPS (Hetzner + Cloudflare Tunnel) — `academia.flynnpedroa.engineer`
- ✅ Rol admin + panel `/admin` (herramientas, categorías, usuarios); admins por `ADMIN_EMAILS`
- ✅ Páginas legales (`/terminos`, `/privacidad`) y 404/500 propias
- ✅ Headers de seguridad (CSP con hashes, `X-Frame-Options`, `Referrer-Policy`, HSTS)
- ✅ SEO: `sitemap.xml`, `robots.txt`, canonical y OG image generada por herramienta
- ✅ CI (typecheck + tests) y deploy automático en cada push a `main` (GitHub Actions)
- ✅ Backups diarios de Postgres con rotación (copia fuera del VPS: código listo, falta el bucket)

**Falta para cerrar v1**: probar la suscripción contra MP sandbox, pasar el OAuth de Google a
"producción" y cargar las herramientas reales. El estado vivo del trabajo está en
[`TODO.md`](TODO.md); lo terminado, en [`DONE.md`](DONE.md).

## Stack

- **Frontend**: Astro 5 + React islands
- **Backend**: Hono sobre Bun
- **ORM / DB**: Drizzle + Postgres 16
- **Auth**: Auth.js v5 (solo Google) + JWT
- **Pagos**: MercadoPago Preapproval + webhook
- **Deploy**: Docker Compose en VPS (Hetzner) detrás de Cloudflare Tunnel

## Cómo correr el frontend

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

Deploy al VPS: `make help` y [despliegue-vps.md](docs/despliegue-vps.md#deploy-con-el-makefile).

## Documentos de referencia

| Doc | Contenido |
|---|---|
| [arquitectura.md](docs/arquitectura.md) | Stack detallado, diagrama, decisiones |
| [schema-datos.md](docs/schema-datos.md) | Modelo de datos (v1 + hooks para cursos futuros) |
| [auth-y-pagos.md](docs/auth-y-pagos.md) | Flujo Google OAuth + MP Preapproval + webhooks |
| [despliegue-vps.md](docs/despliegue-vps.md) | Docker Compose, Cloudflare Tunnel, Makefile, deploy automático, backups |
| [roadmap.md](docs/roadmap.md) | Fases v1 → v2 → v3 |
| [diseño-brief.md](docs/diseño-brief.md) | Brief para `/design-shotgun` |

## Estructura

```
laforja.dev/
├── .github/workflows/     # ci.yml (typecheck + tests) y deploy.yml (deploy al VPS)
├── apps/
│   ├── api/               # Hono + Bun + Drizzle (REST)
│   │   ├── drizzle/        # migraciones generadas
│   │   └── src/
│   │       ├── db/         # schema, cliente, migrate, seed
│   │       ├── lib/        # unlocks, MercadoPago, rate limit, admin
│   │       └── routes/
│   └── web/               # Astro + React (landing, dashboard, admin, auth)
│       ├── src/
│       │   ├── components/
│       │   ├── lib/        # cliente de la API (server-side), firma del JWT, OG images
│       │   ├── layouts/
│       │   ├── pages/
│       │   └── styles/
│       ├── astro.config.mjs
│       └── package.json
├── ops/backup/            # contenedor de pg_dump con rotación
├── scripts/               # setup del VPS y deploy desde CI
├── docs/                  # documentos de referencia
├── docker-compose.yml
├── Makefile               # deploy y operación del VPS (`make help`)
├── TODO.md / DONE.md      # estado del trabajo (ver CLAUDE.md §2)
└── README.md
```
