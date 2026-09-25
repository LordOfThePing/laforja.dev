# Autenticación y pagos

## Google OAuth

1. Usuario clickea "Ingresar con Google" en la web
2. Auth.js redirige a Google
3. Callback → Auth.js valida y guarda la sesión en su cookie
4. Para hablar con la API, la web firma **su propio** JWT (ver contrato abajo) —
   no reenvía el token interno de Auth.js, que por default es un JWE cifrado
5. El frontend envía ese JWT en `Authorization: Bearer` en cada request a la API
6. El backend valida el JWT con la misma `AUTH_SECRET` y hace `upsert` en
   `users` por `google_id` (la web no tiene acceso a la DB)

### Contrato del JWT web → API

- Algoritmo: `HS256`, firmado con `AUTH_SECRET`
- Claims obligatorios:
  - `sub` — el `sub` de Google (se guarda como `users.google_id`)
  - `email`
  - `aud` — siempre `"laforja-api"`
  - `exp` — obligatorio; tokens sin vencimiento se rechazan
- Claims opcionales: `name`, `picture` (→ `users.avatar_url`)
- Cualquier token inválido, vencido o incompleto → `401 {"error":"unauthorized"}`
- En cada request autenticado se actualizan `email`, `name` y `avatar_url`
  desde los claims

Para probar sin la web: `cd apps/api && bun run token:dev [email]` imprime un
token válido por 7 días firmado con el `AUTH_SECRET` del `.env`.

### Cupo mensual

`month_key` se calcula en hora de Argentina (`America/Argentina/Buenos_Aires`),
así el cupo se resetea a la medianoche local del día 1, no a la de UTC.

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
| `GET` | `/api/me` | Perfil + estado de suscripción (`hasAccess`) + unlocks del mes (`used`, `remaining`, `tools`). Requiere auth |
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
