# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso


## Pendiente

- Probar la suscripción contra MP sandbox (credenciales TEST, webhook configurado en el panel de MP apuntando al tunnel) — pendiente — depende de Cloudflare Tunnel
- Conectar `apps/web` a la API real (reemplazar mock de `src/data/tools.ts`) — pendiente
- Seguridad SSH del VPS: `/etc/ssh/sshd_config.d/50-cloud-init.conf` pone `PasswordAuthentication yes` y pisa el `no` de `sshd_config` — pendiente — decisión del usuario, afecta a todos los proyectos del VPS
- Cloudflare Tunnel para toda la app (web + api por el mismo tunnel, sin Pages) — pendiente — reemplaza Nginx + Certbot de `docs/despliegue-vps.md`; sin puertos abiertos ni certificados en el VPS. Se descartó Pages porque la web es Astro SSR y comparte `AUTH_SECRET` con la API
