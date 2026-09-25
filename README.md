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
- ⏳ Backend (`apps/api`, Hono + Bun) — pendiente
- ⏳ DB (Postgres + Drizzle) — pendiente
- ⏳ Auth.js con Google — pendiente
- ⏳ Integración MP Preapproval + webhooks — pendiente
- ⏳ Docker Compose + Nginx en VPS — pendiente

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
