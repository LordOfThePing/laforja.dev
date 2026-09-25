# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

_(nada)_

## Pendiente

- Probar la suscripción contra MP sandbox (credenciales TEST, webhook configurado en el panel de MP apuntando al tunnel) — pendiente — depende de Cloudflare Tunnel
- Conectar `apps/web` a la API real (reemplazar mock de `src/data/tools.ts`) — pendiente
- Seguridad SSH del VPS: `/etc/ssh/sshd_config.d/50-cloud-init.conf` pone `PasswordAuthentication yes` y pisa el `no` de `sshd_config` — pendiente — decisión del usuario, afecta a todos los proyectos del VPS
- Cloudflare Tunnel para toda la app — pendiente — **siguiente tarea**. Decisiones ya tomadas:
  - Dominio: `academia.flynnpedroa.engineer` (está en la cuenta de Cloudflare del usuario). `laforja.dev` más adelante.
  - Web + api por el mismo tunnel, sin Pages. Seguir el patrón de los otros proyectos del VPS: `cloudflared` como servicio dentro del `docker-compose.yml` (`cloudflare/cloudflared`, `tunnel run` con `TUNNEL_TOKEN`), en la red `internal`.
  - El usuario crea el tunnel en Zero Trust → Networks → Tunnels y pone el token en `.env.production` como `CLOUDFLARE_TUNNEL_TOKEN` (no pasarlo por chat). Agregar la variable a `.env.example` y al compose.
  - Public hostnames en el panel del tunnel, **en este orden** (Cloudflare matchea el primero): `academia.flynnpedroa.engineer` path `/api/auth/*` → `http://web:3000` (**ojo**: `/api/auth/*` es Auth.js de la web, no la api; si cae en la api el login se rompe), path `/api/*` → `http://api:4000`, path `/webhooks/*` → `http://api:4000`, resto → `http://web:3000`.
  - Con el tunnel, sacar los `ports:` de web/api del compose (o dejarlos opcionales): no hace falta publicar nada al host. En el VPS el 3000 está ocupado.
  - Actualizar `docs/despliegue-vps.md`: reemplazar Nginx + Certbot + DNS por el tunnel.
  - Verificar tras el deploy: login con Google (`AUTH_URL`/callback `https://academia.flynnpedroa.engineer/api/auth/callback/google` en Google Cloud Console), `x-forwarded-proto` https, `cf-connecting-ip` llega a la api (rate limit).
  - Deploy: el usuario completa `.env.production` → `make env-push` → `make deploy` → `make seed`. VPS ya listo (usuario `deploy-laforja`, alias `laforja`, repo clonado en `/opt/laforja`).
