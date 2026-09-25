# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

_(nada)_

## Pendiente

- **Primer deploy a producción** — pendiente — **siguiente**. El repo ya está listo (`cloudflared` en compose, docs en `docs/despliegue-vps.md` § Cloudflare Tunnel). Pasos del usuario:
  1. Crear el tunnel `laforja` en Cloudflare Zero Trust y cargar los 4 public hostnames **en el orden del doc** (`/api/auth/*` → web primero).
  2. Completar `.env.production` desde `.env.example`: secretos, `FRONTEND_URL=https://academia.flynnpedroa.engineer`, `WEB_PORT=3200`, `COMPOSE_PROFILES=tunnel`, `CLOUDFLARE_TUNNEL_TOKEN`.
  3. Google Cloud Console: origin + redirect URI de producción.
  4. `make env-push && make deploy && make seed`.
  5. Verificar: home y `/api/tools` por https, login con Google, `make logs SERVICE=cloudflared` sin errores.
- Dashboard + botón "Suscribirme" en la web (`/suscripcion`, `/dashboard/gracias` — hoy 404; `POST /api/subscription/create|cancel` ya existen) — pendiente
- Probar la suscripción contra MP sandbox (credenciales TEST, webhook configurado en el panel de MP apuntando al tunnel) — pendiente — depende de Cloudflare Tunnel
- Seguridad SSH del VPS: `/etc/ssh/sshd_config.d/50-cloud-init.conf` pone `PasswordAuthentication yes` y pisa el `no` de `sshd_config` — pendiente — decisión del usuario, afecta a todos los proyectos del VPS
