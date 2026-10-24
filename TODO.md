# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso


## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Pasar Lemon Squeezy a modo live: repetir producto (variants Oficial/Maestro), API key y webhook en live y actualizar las 5 variables `LEMONSQUEEZY_*` → `make env-push` + `make up` — pendiente (usuario) — en test mode ya anda punta a punta en prod (checkout + webhook + activación, 2026-10-24); pasos en `docs/despliegue-vps.md` → Lemon Squeezy
- Activar la newsletter: cuenta en Resend, verificar `laforja.dev` (SPF/DKIM en Cloudflare), `RESEND_API_KEY` en `.env.production` — pendiente — depende de que `laforja.dev` resuelva; pasos en `docs/despliegue-vps.md` → Newsletter

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL` y redirect 301 del dominio viejo (después sacar `legacyHost` de `apps/web/astro.config.mjs`) — pendiente — tunnel, callback de Google, webhook de MP y `SITE_URL` del workflow Uptime ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

