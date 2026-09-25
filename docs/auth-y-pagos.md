# Autenticación y pagos

## Google OAuth

1. Usuario clickea "Ingresar con Google" en la web
2. Auth.js redirige a Google
3. Callback → Auth.js valida y hace `upsert` en `users`
4. Auth.js emite session cookie + JWT firmado con `AUTH_SECRET`
5. El frontend envía el JWT en `Authorization: Bearer` en cada request a la API
6. El backend valida el JWT usando la misma secret

## MercadoPago Preapproval — suscripción

### Creación

1. Usuario en dashboard → "Suscribirme"
2. Frontend → `POST /api/subscription/create`
3. Backend crea Preapproval con SDK de MP:
   ```json
   {
     "reason": "La Forja — Suscripción mensual",
     "auto_recurring": {
       "frequency": 1,
       "frequency_type": "months",
       "transaction_amount": 4000,
       "currency_id": "ARS"
     },
     "back_url": "https://laforja.dev/dashboard/gracias",
     "payer_email": "<email del usuario>",
     "external_reference": "<user_id>"
   }
   ```
4. Backend responde con `init_point` (URL de MP para pagar)
5. Frontend redirige al usuario a `init_point`
6. Usuario paga en MP
7. MP redirige a `back_url` con `preapproval_id`

### Activación (webhook)

1. MP dispara webhook `POST /webhooks/mercadopago`
2. Backend valida firma con `MP_WEBHOOK_SECRET`
3. Si el evento es `subscription_preapproval` con status `authorized`:
   - `users.subscription_status = 'active'`
   - `users.subscription_id = <preapproval_id>`
   - `users.current_period_end = <next_payment_date>`
4. Guarda evento en `subscription_events` para idempotencia (`mp_event_id` unique)

### Renovación mensual

- MP dispara `payment` events cuando cobra
- Backend actualiza `current_period_end` con el siguiente periodo
- Si `payment.status = 'rejected'`, marcar `subscription_status = 'paused'`

### Cancelación

1. Usuario en dashboard → "Cancelar suscripción"
2. Backend → PUT MP Preapproval con status `cancelled`
3. Webhook confirma → `users.subscription_status = 'cancelled'`
4. Acceso premium se mantiene hasta `current_period_end`

## Endpoints de la API

| Método | Path | Descripción |
|---|---|---|
| `GET` | `/api/me` | Perfil + estado de suscripción + unlocks del mes |
| `GET` | `/api/tools` | Lista pública (todas, con flag `is_locked`) |
| `GET` | `/api/tools/:slug` | Detalle. Si está bloqueada devuelve solo el preview con `isLocked: true` (sirve para SEO); 404 si no existe o no está publicada |
| `POST` | `/api/tools/:slug/unlock` | Registra unlock, devuelve prompt + video |
| `POST` | `/api/subscription/create` | Crea Preapproval, devuelve `init_point` |
| `POST` | `/api/subscription/cancel` | Cancela suscripción |
| `POST` | `/webhooks/mercadopago` | Webhook de MP |

## Seguridad

- JWT expirable en 7 días, refresh en cada request
- Webhook MP: validar firma HMAC (header `x-signature`) contra `MP_WEBHOOK_SECRET`
- Idempotencia: `mp_event_id` unique constraint impide procesar el mismo evento dos veces
- Rate limit en `/api/tools/:slug/unlock` para evitar spam
