# TODO

Tareas pendientes y en curso. Ver `CLAUDE.md` (§2) para el workflow.

## En curso

- Integrar Stripe como segundo payment provider (convive con MP) — en curso — Backend listo (compila + 224 tests pasan): schema con `payment_provider` + `stripe_customer_id` + `stripe_subscription_id`, migración `0010_stripe.sql`, rename `mp_event_id` → `provider_event_id`, `lib/stripe.ts` con HMAC + Checkout, `lib/stripe-sync.ts`, `POST /api/subscription/create` con `provider`, `POST /webhooks/stripe` con firma + idempotencia, cancelación por provider, `reconcileStripeSubscriptions`, vars `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` (todas opcionales → sin ellas Stripe queda apagado). **Falta**: (a) UI `/suscripcion` con toggle AR/Internacional y precios USD ($7 / $20), (b) `createSubscription` en `apps/web/src/lib/api.ts` pasando `provider`, (c) tests de Stripe (FakeStripe + webhook happy path + firma + reconcile), (d) actualizar `docs/auth-y-pagos.md` + `docs/schema-datos.md` + `docs/despliegue-vps.md` con las 4 vars nuevas, (e) crear los Prices en el dashboard de Stripe (basic $7/mes, pro $20/mes) y copiar los IDs a `.env.production`. Pricing + modo de checkout = Checkout hosted, $7 / $20 (decisión tomada por mí, no confirmada por el usuario — revisar si corresponde)

## Pendiente

### v1 — cerrar el MVP

- Cargar las herramientas reales (videos + prompts) y sacar el seed de ejemplo de prod — pendiente — depende del panel admin

### Operación / producción

- Activar la newsletter: cuenta en Resend, verificar `laforja.dev` (SPF/DKIM en Cloudflare), `RESEND_API_KEY` en `.env.production` — pendiente — depende de que `laforja.dev` resuelva; pasos en `docs/despliegue-vps.md` → Newsletter

### SEO y crecimiento

- Migrar a `laforja.dev`: falta `FRONTEND_URL` y redirect 301 del dominio viejo (después sacar `legacyHost` de `apps/web/astro.config.mjs`) — pendiente — tunnel, callback de Google, webhook de MP y `SITE_URL` del workflow Uptime ya configurados; ver `docs/despliegue-vps.md`

### v2 — Cursos (ver `docs/roadmap.md`)


### v3 — Comunidad

