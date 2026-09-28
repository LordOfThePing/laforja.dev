# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Copia de backups fuera del VPS: activar la subida a R2 y verificarla — en curso por @claude — bucket y token ya creados, `BACKUP_S3_*` cargados
- Backups en el panel admin: estado, dumps, config y «Hacer backup ahora» + log de arranque en `loop.sh` — en curso por @claude

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Nav en mobile: debajo de 780px los links (Herramientas, Cursos, …) se ocultan y no hay menú — pendiente

### SEO y crecimiento

- Analytics livianas y respetuosas (Plausible/Umami self-hosted) — pendiente — el roadmap v3 pide métricas de desbloqueos; esto cubre tráfico
- Migrar a `laforja.dev` (hostnames del tunnel, `FRONTEND_URL`, callback de Google, webhook de MP, redirect 301, `site` en `apps/web/astro.config.mjs`: de ahí salen canonical, sitemap y OG; variable `SITE_URL` del workflow Uptime) — pendiente — ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)

- Progreso por % de video en el reproductor — pendiente — requiere la IFrame API de YouTube (script externo: sumarlo a la CSP); hoy el progreso es completada / no completada

### v3 — Comunidad

- Comentarios en herramientas (solo suscriptores) — pendiente
- Colecciones / rutas de aprendizaje curadas — pendiente
- Newsletter integrada (Resend) — pendiente
- Analytics propias: qué se desbloquea más, retención — pendiente
