# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Reemplazar Stripe por Lemon Squeezy como provider internacional (USD) — en curso por @claude — Stripe no acepta cuentas de Argentina; LS es merchant of record y paga a banco argentino

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Activar la newsletter: cuenta en Resend, verificar `laforja.dev` (SPF/DKIM en Cloudflare), `RESEND_API_KEY` en `.env.production` — pendiente — depende de que `laforja.dev` resuelva; pasos en `docs/despliegue-vps.md` → Newsletter

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL` y redirect 301 del dominio viejo (después sacar `legacyHost` de `apps/web/astro.config.mjs`) — pendiente — tunnel, callback de Google, webhook de MP y `SITE_URL` del workflow Uptime ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

