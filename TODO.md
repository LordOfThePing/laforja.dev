# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Componente `<Markdown>` reusable + estilos en `globals.css`: aplicar a herramientas, lecciones, cursos y rutas — en curso por @claude
- Botón lateral "IR AL PROMPT PARA EL AGENTE" en la página de herramienta que ancla al prompt — en curso por @claude

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Activar la newsletter: cuenta en Resend, verificar `laforja.dev` (SPF/DKIM en Cloudflare), `RESEND_API_KEY` en `.env.production` — pendiente — depende de que `laforja.dev` resuelva; pasos en `docs/despliegue-vps.md` → Newsletter

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL`, redirect 301 del dominio viejo (después sacar `legacyHost` de `apps/web/astro.config.mjs`) y variable `SITE_URL` del workflow Uptime — pendiente — tunnel, callback de Google y webhook de MP ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

