# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- **Agregar regla de `git fetch` previo en `CLAUDE.md` §2.1** — en curso
  por @claude — para prevenir que dos agentes agarren la misma tarea con
  copias desactualizadas del repo.

## Pendiente

- Login con Google en `apps/web` (Auth.js) que firme el JWT del contrato de `docs/auth-y-pagos.md` — pendiente
- Unlocks: `POST /api/tools/:slug/unlock` con cupo de 2/mes — pendiente
- Suscripción MP Preapproval + webhook — pendiente
- Conectar `apps/web` a la API real (reemplazar mock de `src/data/tools.ts`) — pendiente
- Dockerizar la app: Dockerfiles de `apps/api` y `apps/web` + `docker-compose.yml` (web, api, postgres) — pendiente
- Cloudflare Tunnel para toda la app (web + api por el mismo tunnel, sin Pages) — pendiente — reemplaza Nginx + Certbot de `docs/despliegue-vps.md`; sin puertos abiertos ni certificados en el VPS. Se descartó Pages porque la web es Astro SSR y comparte `AUTH_SECRET` con la API
- VPS Hetzner: entrar por SSH, crear usuario `deploy`, cargar la key de esta máquina y configurar un alias en `~/.ssh/config` — pendiente
- Makefile de deploy: target con `scp` del `.env` al VPS + comandos generales (build, up, logs, migraciones, seed) — pendiente — depende de dockerizar y del usuario `deploy`
