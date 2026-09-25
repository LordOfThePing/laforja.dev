# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

_(nada)_

## Pendiente

- Probar la suscripción contra MP sandbox (credenciales TEST, webhook configurado en el panel de MP apuntando al tunnel) — pendiente — depende de Cloudflare Tunnel
- Conectar `apps/web` a la API real (reemplazar mock de `src/data/tools.ts`) — pendiente
- Cloudflare Tunnel para toda la app (web + api por el mismo tunnel, sin Pages) — pendiente — reemplaza Nginx + Certbot de `docs/despliegue-vps.md`; sin puertos abiertos ni certificados en el VPS. Se descartó Pages porque la web es Astro SSR y comparte `AUTH_SECRET` con la API
- VPS Hetzner: entrar por SSH, crear usuario `deploy` (grupo `docker`, dueño de `/opt/laforja`), cargar la key de esta máquina, alias `laforja` en `~/.ssh/config` y deploy key de GitHub para clonar — pendiente — ver requisitos en `docs/despliegue-vps.md`; el VPS ya tiene otros servicios (alias `hetzner`, `hetzner-db`)
