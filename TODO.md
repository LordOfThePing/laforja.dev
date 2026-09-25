# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Auth: validar JWT de Auth.js en `apps/api` + `GET /api/me` — en curso por @claude —
  middleware Bearer HS256 con `AUTH_SECRET`, upsert del user desde los claims,
  `/api/me` con perfil + suscripción + unlocks del mes

## Pendiente

- Unlocks: `POST /api/tools/:slug/unlock` con cupo de 2/mes — pendiente — depende de auth
- Suscripción MP Preapproval + webhook — pendiente — depende de auth
- Conectar `apps/web` a la API real (reemplazar mock de `src/data/tools.ts`) — pendiente
- Dockerfile de `apps/api` + `docker-compose.yml` — pendiente
