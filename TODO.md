# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Copia de backups fuera del VPS: verificar la primera subida a R2 — en curso por @claude — bucket, token y `BACKUP_S3_*` listos; falta `make deploy` y «Hacer backup ahora» en Admin → Backups

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Activar Umami en prod (profile `analytics`, secretos, cambiar password de admin, `UMAMI_WEBSITE_ID`) — pendiente — pasos en `docs/despliegue-vps.md` → Analytics

### SEO y crecimiento

- Migrar a `laforja.dev` (hostnames del tunnel, `FRONTEND_URL`, callback de Google, webhook de MP, redirect 301, `site` en `apps/web/astro.config.mjs`: de ahí salen canonical, sitemap y OG; variable `SITE_URL` del workflow Uptime) — pendiente — ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)

- Progreso por % de video en el reproductor — pendiente — requiere la IFrame API de YouTube (script externo: sumarlo a la CSP); hoy el progreso es completada / no completada

### v3 — Comunidad

- Comentarios en herramientas (solo suscriptores) — pendiente
- Colecciones / rutas de aprendizaje curadas — pendiente
- Newsletter integrada (Resend) — pendiente
- Analytics propias: qué se desbloquea más, retención — pendiente
