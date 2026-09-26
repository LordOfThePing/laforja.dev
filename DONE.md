# DONE

Tareas terminadas. Formato: `- YYYY-MM-DD — <título> — <hash opcional>`.
Ver `CLAUDE.md` (§2) para el workflow.

---

- 2026-09-25 — Bootstrap del workflow (`CLAUDE.md`, `TODO.md`, `DONE.md`)
- 2026-09-25 — Bootstrap del backend `apps/api` (Hono + Bun + Drizzle, schema v1, endpoints públicos, seed) — 433c67d
- 2026-09-25 — Auth JWT en `apps/api` + `GET /api/me` — e258f13
- 2026-09-25 — Regla de `git fetch` previo al claim en `CLAUDE.md` §2.1 (previene claims duplicados)
- 2026-09-25 — Unlocks con cupo de 2/mes + `isLocked` por usuario en `apps/api` — 9a4dacd
- 2026-09-25 — Suscripción MP Preapproval + webhook en `apps/api` — 34ee48b
- 2026-09-25 — Dockerizar la app (Dockerfiles api/web + docker-compose con migrate) — 6115bf0
- 2026-09-25 — Rate limit en unlock y webhook de MP — 05a32fb
- 2026-09-25 — Makefile de deploy — 7a22745
- 2026-09-25 — Login con Google en `apps/web` (Auth.js v5) + `GET /api/auth/token` que firma el JWT del contrato — 01dc6a4
- 2026-09-25 — VPS Hetzner: usuario `deploy-laforja`, `/opt/laforja`, alias `laforja` — 1c8c581
- 2026-09-25 — Fix de env de Auth.js en la imagen Docker de la web — 3790522
- 2026-09-25 — Cloudflare Tunnel en el repo (cloudflared en compose + docs) — 1605aa5
- 2026-09-25 — Makefile usable desde PowerShell/cmd en Windows — 411b9a9
- 2026-09-25 — Makefile en Windows: recetas simples fallaban con CreateProcess — a582e85
- 2026-09-25 — Makefile corrible desde el VPS + alias `ssh laforja` con RemoteCommand — c4c0f6c, b29fb90
- 2026-09-25 — Fix 403 cross-site en login con Google detrás del tunnel (allowedDomains de Astro) — 0be0344
- 2026-09-25 — Web conectada a la API real (catálogo, `/herramientas/:slug`, desbloqueo) — cd4e1bb
- 2026-09-25 — Dashboard + flujo de suscripción en la web (`/suscripcion`, `/dashboard`, `/dashboard/gracias`) — de5945f
- 2026-09-26 — Primer deploy a producción (academia.flynnpedroa.engineer vía Cloudflare Tunnel)
- 2026-09-26 — SSH del VPS solo por clave (`00-hardening.conf` pisa cloud-init) — c082451
- 2026-09-26 — Ícono de Google en el botón de login (viewBox 48x48 + path azul) — fdf7842
- 2026-09-26 — Relevamiento de lo pendiente (v1, operación, SEO, v2, v3) en `TODO.md` — 4a09f9e
- 2026-09-26 — Rol admin (`ADMIN_EMAILS`, pepeflynn22@gmail.com) + panel `/admin` (herramientas, categorías, usuarios) — 17a0ef0, 64c957d
- 2026-09-26 — Deploy automático con GitHub Actions en cada push a `main` — 6624b26
- 2026-09-26 — Páginas 404/500 propias con el estilo del sitio — 3f8ed1e, adcfff7
- 2026-09-26 — Páginas `/terminos` y `/privacidad` — 1d4aaca
- 2026-09-26 — CI en GitHub Actions (typecheck + tests de api, typecheck + build de web) — 67f286d, 037cae3
- 2026-09-26 — Headers de seguridad en la web (CSP con hashes, frame-ancestors, HSTS, etc.) — c37138b
- 2026-09-26 — `sitemap.xml` + `robots.txt` + OG image por herramienta (y del sitio) — 008c333, e8bfd08
- 2026-09-26 — Backups diarios de Postgres (servicio `backup`, rotación, `make backup`/`backups`/`backup-pull`) — 116b87b
- 2026-09-26 — README y roadmap al día con el estado de v1 — 61cf9fd
