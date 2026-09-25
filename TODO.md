# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- **Login con Google en `apps/web` (Auth.js v5)** — en curso por @claude —
  firma el JWT del contrato de `docs/auth-y-pagos.md`, guarda sesión, expone
  el token para pegarle a la API. Sin conflicto con la tarea de unlocks
  (esa toca `apps/api/`, esta toca `apps/web/`).
- Makefile de deploy — en curso por @claude — `scp` del `.env` al VPS +
  deploy/logs/migrate/seed vía alias SSH `laforja`. Solo agrega `Makefile` y docs.

## Pendiente

- Probar la suscripción contra MP sandbox (credenciales TEST, webhook configurado en el panel de MP apuntando al tunnel) — pendiente — depende de Cloudflare Tunnel
- Conectar `apps/web` a la API real (reemplazar mock de `src/data/tools.ts`) — pendiente
- Cloudflare Tunnel para toda la app (web + api por el mismo tunnel, sin Pages) — pendiente — reemplaza Nginx + Certbot de `docs/despliegue-vps.md`; sin puertos abiertos ni certificados en el VPS. Se descartó Pages porque la web es Astro SSR y comparte `AUTH_SECRET` con la API
- VPS Hetzner: entrar por SSH, crear usuario `deploy`, cargar la key de esta máquina y configurar un alias en `~/.ssh/config` — pendiente
