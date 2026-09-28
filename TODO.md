# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Comentarios en herramientas (solo suscriptores) — en curso por @claude
- Copia de backups fuera del VPS: verificar la primera subida a R2 — en curso por @claude — bucket, token y `BACKUP_S3_*` listos; falta `make deploy` y «Hacer backup ahora» en Admin → Backups

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Activar Umami en prod (profile `analytics`, secretos, cambiar password de admin, `UMAMI_WEBSITE_ID`) — pendiente — pasos en `docs/despliegue-vps.md` → Analytics

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL`, redirect 301 del dominio viejo, `site` en `apps/web/astro.config.mjs` (de ahí salen canonical, sitemap y OG) y variable `SITE_URL` del workflow Uptime — pendiente — tunnel, callback de Google y webhook de MP ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

- Colecciones / rutas de aprendizaje curadas — pendiente
- Newsletter integrada (Resend) — pendiente
