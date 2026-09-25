# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

_(nada)_

## Pendiente

- Login con Google en `apps/web` (Auth.js) que firme el JWT del contrato de `docs/auth-y-pagos.md` — pendiente
- Unlocks: `POST /api/tools/:slug/unlock` con cupo de 2/mes — pendiente
- Suscripción MP Preapproval + webhook — pendiente
- Conectar `apps/web` a la API real (reemplazar mock de `src/data/tools.ts`) — pendiente
- Dockerizar la app: Dockerfiles de `apps/api` y `apps/web` + `docker-compose.yml` (web, api, postgres) — pendiente
- Cloudflare Tunnel: decidir si el tunnel expone solo la API y el frontend va a Cloudflare Pages, o si toda la app va por el tunnel — pendiente — decisión abierta; puede reemplazar Nginx + Certbot de `docs/despliegue-vps.md`
- VPS Hetzner: entrar por SSH, crear usuario `deploy`, cargar la key de esta máquina y configurar un alias en `~/.ssh/config` — pendiente
- Makefile de deploy: target con `scp` del `.env` al VPS + comandos generales (build, up, logs, migraciones, seed) — pendiente — depende de dockerizar y del usuario `deploy`
