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
