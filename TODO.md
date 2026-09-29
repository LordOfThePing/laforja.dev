# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Destrabar el pago de MP en producción — en curso por @claude — `MP_BACK_URL` ya es configurable (507ccda); falta armar un Worker en `workers.dev` que redirija a `${FRONTEND_URL}/dashboard/gracias`, setear `MP_BACK_URL` en `.env.production` del VPS y probar de punta a punta
- Copia de backups fuera del VPS: verificar la primera subida a R2 — en curso por @claude — bucket, token y `BACKUP_S3_*` listos; falta `make deploy` y «Hacer backup ahora» en Admin → Backups

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Activar la newsletter: cuenta en Resend, verificar `laforja.dev` (SPF/DKIM en Cloudflare), `RESEND_API_KEY` en `.env.production` — pendiente — depende de que `laforja.dev` resuelva; pasos en `docs/despliegue-vps.md` → Newsletter
- Activar Umami en prod (profile `analytics`, secretos, cambiar password de admin, `UMAMI_WEBSITE_ID`) — pendiente — pasos en `docs/despliegue-vps.md` → Analytics

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL`, redirect 301 del dominio viejo (después sacar `legacyHost` de `apps/web/astro.config.mjs`) y variable `SITE_URL` del workflow Uptime — pendiente — tunnel, callback de Google y webhook de MP ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

