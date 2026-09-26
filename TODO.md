# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Landing `/cursos` con temario público y reproductor de lecciones con progreso — en curso por @claude-2

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Copia de backups fuera del VPS: crear bucket R2 + token y cargar `BACKUP_S3_*` en el `.env` del VPS — pendiente — el código ya lo soporta; ver "Backups de Postgres" en `docs/despliegue-vps.md`

### SEO y crecimiento

- Analytics livianas y respetuosas (Plausible/Umami self-hosted) — pendiente — el roadmap v3 pide métricas de desbloqueos; esto cubre tráfico
- Migrar a `laforja.dev` (hostnames del tunnel, `FRONTEND_URL`, callback de Google, webhook de MP, redirect 301, `site` en `apps/web/astro.config.mjs`: de ahí salen canonical, sitemap y OG; variable `SITE_URL` del workflow Uptime) — pendiente — ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)

- Admin de cursos en `/admin` (cursos, módulos, lecciones, orden y preview) — pendiente — hoy los cursos solo entran por el seed
- Certificado de completado en PDF — pendiente

### v3 — Comunidad

- Comentarios en herramientas (solo suscriptores) — pendiente
- Colecciones / rutas de aprendizaje curadas — pendiente
- Newsletter integrada (Resend) — pendiente
- Analytics propias: qué se desbloquea más, retención — pendiente
