# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso


## Pendiente

### v1 — cerrar el MVP

- Probar la suscripción contra MP sandbox (credenciales TEST, webhook del panel de MP apuntando a `/webhooks/mercadopago`) — pendiente — pospuesto por el usuario; bloquea el criterio de done de v1
- Pantalla de consentimiento de Google OAuth en modo "producción" — pendiente — en modo testing solo entran los usuarios de prueba; requiere las páginas legales
- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin
- Actualizar `README.md` (estado: el deploy ya está hecho) y tildar lo cumplido en `docs/roadmap.md` — pendiente

### Operación / producción

- Backups diarios de Postgres (`pg_dump` con rotación, idealmente copia fuera del VPS) — pendiente — hoy la única copia es el volumen `pg_data`
- Monitoreo de uptime de `/health` y de la web + aviso si cae — pendiente
- Reconciliación periódica de suscripciones contra MP (por si se pierde un webhook) — pendiente — evaluar después de probar MP

### SEO y crecimiento

- `sitemap.xml` + `robots.txt` + OG image por herramienta — pendiente
- Analytics livianas y respetuosas (Plausible/Umami self-hosted) — pendiente — el roadmap v3 pide métricas de desbloqueos; esto cubre tráfico
- Migrar a `laforja.dev` (hostnames del tunnel, `FRONTEND_URL`, callback de Google, webhook de MP, redirect 301) — pendiente — ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)

- Tablas `courses` / `modules` / `lessons` / `progress` + endpoints — pendiente
- Landing `/cursos` con temario público y reproductor de lecciones con progreso — pendiente
- Certificado de completado en PDF — pendiente

### v3 — Comunidad

- Comentarios en herramientas (solo suscriptores) — pendiente
- Colecciones / rutas de aprendizaje curadas — pendiente
- Newsletter integrada (Resend) — pendiente
- Analytics propias: qué se desbloquea más, retención — pendiente
