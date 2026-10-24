# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Integrar Stripe como segundo payment provider (convive con MP) — pendiente — MP sigue para ARS, Stripe para internacional en USD. Abstraer `PaymentProvider`, agregar `providers/stripe.ts`, columnas `payment_provider` + `stripe_customer_id` + `stripe_subscription_id` en `users`, `POST /webhooks/stripe` con firma + idempotencia, reconciliación, toggle AR/Internacional en `/suscripcion`, vars `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO`, actualizar `docs/auth-y-pagos.md` y `docs/schema-datos.md`. Falta confirmar precios USD y modo de checkout (recomendado: Checkout hosted + precios ~$7 / $20)

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Activar la newsletter: cuenta en Resend, verificar `laforja.dev` (SPF/DKIM en Cloudflare), `RESEND_API_KEY` en `.env.production` — pendiente — depende de que `laforja.dev` resuelva; pasos en `docs/despliegue-vps.md` → Newsletter

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL` y redirect 301 del dominio viejo (después sacar `legacyHost` de `apps/web/astro.config.mjs`) — pendiente — tunnel, callback de Google, webhook de MP y `SITE_URL` del workflow Uptime ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

