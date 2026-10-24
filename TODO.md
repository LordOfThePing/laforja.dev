# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso


## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Prender Stripe en prod: secret key + webhook `https://laforja.dev/webhooks/stripe` (eventos `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) → `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` en `.env.production`, `make env-push` + restart api — pendiente (usuario) — pasos en `docs/despliegue-vps.md` → Stripe; revisar montos en `/admin/precios`
- Activar la newsletter: cuenta en Resend, verificar `laforja.dev` (SPF/DKIM en Cloudflare), `RESEND_API_KEY` en `.env.production` — pendiente — depende de que `laforja.dev` resuelva; pasos en `docs/despliegue-vps.md` → Newsletter

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL` y redirect 301 del dominio viejo (después sacar `legacyHost` de `apps/web/astro.config.mjs`) — pendiente — tunnel, callback de Google, webhook de MP y `SITE_URL` del workflow Uptime ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

