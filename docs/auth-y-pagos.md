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

### Rol admin

`users.role` es `user` o `admin`. Un email listado en `ADMIN_EMAILS` (api, separados
por coma, sin importar mayúsculas) se promueve a `admin` en cada login; sacarlo de
la lista **no** lo degrada, eso se hace desde `/admin/usuarios`. Un admin:

- ve todas las herramientas premium sin gastar cupo (como un suscriptor)
- accede a `/api/admin/*` y al panel `/admin` de la web
- no puede sacarse el rol a sí mismo (evita quedarse sin admins)

### Cupo mensual

`month_key` se calcula en hora de Argentina (`America/Argentina/Buenos_Aires`),
así el cupo se resetea a la medianoche local del día 1, no a la de UTC.

## MercadoPago Preapproval — suscripción

### Creación

1. Usuario en `/suscripcion` (o desde `/dashboard`) → "Continuar a MercadoPago"
2. El servidor de la web → `POST /api/subscription/create`
3. Backend crea Preapproval con la API REST de MP (`POST /preapproval`, sin SDK):
   ```json
   {
     "reason": "La Forja — Suscripción mensual",
     "auto_recurring": {
       "frequency": 1,
       "frequency_type": "months",
       "transaction_amount": 4000,
       "currency_id": "ARS"
     },
     "back_url": "<FRONTEND_URL>/dashboard/gracias",
     "payer_email": "<email del usuario>",
     "external_reference": "<user_id>",
     "status": "pending"
   }
   ```
4. Backend responde `{ initPoint, preapprovalId }` (409 `already_subscribed` si
   ya tiene una suscripción activa)
5. Frontend redirige al usuario a `initPoint`
6. Usuario paga en MP
7. MP redirige a `back_url` con `preapproval_id`. `/dashboard/gracias` se
   refresca cada 5 s hasta que el webhook deja la suscripción en `active`

El backend **no** guarda nada al crear: el usuario queda vinculado recién cuando
llega el webhook `authorized`, vía `external_reference`.

### Webhook `POST /webhooks/mercadopago`

1. **Firma**: header `x-signature: ts=<ts>,v1=<hmac>`. Se recalcula
   HMAC-SHA256 (hex) con `MP_WEBHOOK_SECRET` sobre
   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — `data.id` sale del
   **query string** (no del body) y en minúsculas. Firma inválida → `401`.
2. **Idempotencia**: `mp_event_id` = `id` del body de la notificación. Si ya
   está en `subscription_events` → `200 {"status":"duplicate"}` sin procesar.
3. El backend **no confía en el body**: consulta el recurso a MP y actúa según
   el estado real. Si MP falla → `502` sin registrar el evento, y el reintento
   de MP lo vuelve a procesar.
4. Evento + cambio en `users` se guardan en la misma transacción.

| `type` | Qué consulta | Efecto |
|---|---|---|
| `subscription_preapproval` | `GET /preapproval/:id` | `authorized` → `active`, `subscription_id`, `current_period_end`. `paused` / `cancelled` → mismo estado, **solo si** es la `subscription_id` vigente del usuario (cancelar una preapproval vieja no pisa la nueva) |
| `subscription_authorized_payment` | `GET /authorized_payments/:id` + su preapproval | pago `approved` → `active` + renueva `current_period_end`. `rejected` → `paused` |
| otros | — | se guardan en `subscription_events` y se ignoran |

`current_period_end` = `next_payment_date` de la preapproval **+ 3 días de
gracia**: MP cobra ese día y el webhook llega después, así el suscriptor no
pierde acceso durante la renovación.

### Reconciliación con MP (por si se pierde un webhook)

Si un webhook no llega (MP agota los reintentos, la api estaba caída), el
estado local queda desfasado: en el peor caso, alguien que pagó nunca queda
vinculado, porque al crear la preapproval no se guarda nada. Para eso la api
corre `reconcileSubscriptions` (`apps/api/src/reconcile.ts`) cada
`RECONCILE_INTERVAL_HOURS` horas (default 6, `0` la apaga; la primera corrida
es un minuto después de arrancar):

1. `GET /preapproval/search?status=authorized` paginado. Cada una se vincula
   por `external_reference`; si un usuario tiene varias, gana la de
   `next_payment_date` más lejana
2. Usuarios `active` / `paused` cuya preapproval no apareció ahí →
   `GET /preapproval/:id` una por una (así se ven las que MP pausó o canceló).
   Si MP responde 404 se saltea ese usuario y se loguea
3. A cada una le aplica **las mismas reglas** que el webhook
   `subscription_preapproval` (tabla de arriba, `lib/preapproval.ts`). Solo
   escribe si el estado cambia, y deja un evento `reconciliation` en
   `subscription_events` con el antes y el después

Cualquier otro error de MP corta la corrida y se reintenta en la siguiente.
A mano, en el VPS: `make reconcile DRY=1` muestra qué cambiaría sin escribir;
`make reconcile` lo aplica.

### Cancelación

1. Usuario en `/dashboard` → "Cancelar suscripción" → "Sí, cancelar"
2. El servidor de la web → `POST /api/subscription/cancel` (409 `no_active_subscription` si
   no tiene una `active` o `paused`)
3. Backend → `PUT /preapproval/:id` con status `cancelled` y marca
   `subscription_status = 'cancelled'` en el acto (el webhook después confirma lo mismo)
4. Acceso premium se mantiene hasta `current_period_end`

### Errores de MP

Cualquier error de la API de MP en un endpoint se devuelve como
`502 {"error":"payment_provider_error"}`.

## Endpoints de la API

| Método | Path | Descripción |
|---|---|---|
| `GET` | `/api/me` | Perfil + estado de suscripción (`hasAccess`) + unlocks del mes (`used`, `remaining`, `tools`). Requiere auth |
| `GET` | `/api/tools` | Lista pública con `isLocked`. Auth opcional: con token, `isLocked` refleja suscripción + unlocks del mes |
| `GET` | `/api/tools/:slug` | Detalle. Auth opcional. Si está bloqueada para quien pide, devuelve solo el preview con `isLocked: true` (sirve para SEO); 404 si no existe o no está publicada |
| `POST` | `/api/tools/:slug/unlock` | Requiere auth. `201` si consumió cupo, `200` si ya tenía acceso (free, suscriptor o ya desbloqueada este mes), `403 quota_exceeded` si no le queda cupo. Devuelve la herramienta completa + `unlocks` (`used`, `remaining`, `limit`) |
| `GET` | `/api/courses` | Cursos publicados con `moduleCount`, `lessonCount`, `durationSeconds`. Auth opcional: con token suma `progress` (`completed` / `total`) |
| `GET` | `/api/courses/:slug` | Temario público (módulos → lecciones con `isLocked`, sin video ni contenido). Con token, progreso por lección y del curso |
| `GET` | `/api/courses/:slug/lessons/:lesson` | Lección con `prev` / `next` (cruzan módulos). Si está bloqueada, sin `youtubeUrl` ni `contentMd` e `isLocked: true` |
| `PUT` | `/api/courses/:slug/lessons/:lesson/progress` | Requiere auth y acceso a la lección (si no, `403 subscription_required`). Body `{ secondsWatched?, completed? }`; los segundos nunca bajan y `completed_at` guarda la primera vez; `completed: false` lo borra |
| `POST` | `/api/subscription/create` | Requiere auth. Crea Preapproval, devuelve `{ initPoint, preapprovalId }` |
| `POST` | `/api/subscription/cancel` | Requiere auth. Cancela en MP, conserva el período pago |
| `POST` | `/webhooks/mercadopago` | Webhook de MP (firma `x-signature`, idempotente) |

### Admin (`/api/admin/*`)

Requieren auth + `role = admin`; si no, `404` (no se anuncia que existen).
Input inválido → `400 {"error":"invalid_input","field":...}`; slug repetido → `409 slug_taken`.

| Método | Path | Descripción |
|---|---|---|
| `GET` | `/api/admin/stats` | Usuarios, suscriptores activos, unlocks del mes, herramientas (total / publicadas) |
| `GET` | `/api/admin/tools` | Todas, incluidas las no publicadas |
| `GET` / `PATCH` / `DELETE` | `/api/admin/tools/:id` | Detalle / edición parcial / baja |
| `POST` | `/api/admin/tools` | Alta. `publishedAt: null` = borrador |
| `GET` / `POST` | `/api/admin/categories` | Lista (con `toolCount`) / alta |
| `PATCH` / `DELETE` | `/api/admin/categories/:id` | Edición / baja (`409 category_in_use` si tiene herramientas) |
| `GET` | `/api/admin/users` | Últimos 200 usuarios |
| `PATCH` | `/api/admin/users/:id` | `{ role }`. `409 cannot_demote_self` sobre uno mismo |

## Seguridad

- JWT expirable en 7 días, refresh en cada request
- Webhook MP: validar firma HMAC (header `x-signature`) contra `MP_WEBHOOK_SECRET`
- Idempotencia: `mp_event_id` unique constraint impide procesar el mismo evento dos veces
- Auth opcional en endpoints públicos: sin header es anónimo, pero un token presente e inválido da `401` (para que el cliente renueve la sesión)
- `/api/tools/:slug/unlock` toma un lock sobre la fila del usuario (`SELECT … FOR UPDATE`) para que requests concurrentes no superen el cupo
- Rate limit en memoria (ventana fija; alcanza con una sola instancia de api), responde `429 {"error":"rate_limited"}` + `Retry-After`:
  - `POST /api/tools/:slug/unlock`: 10/min **por usuario** (después de validar el token)
  - `PUT /api/courses/:slug/lessons/:lesson/progress`: 60/min **por usuario** (el reproductor lo manda periódicamente)
  - `POST /webhooks/mercadopago`: 300/min **por IP**, antes de validar la firma. La IP sale de `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for`; es confiable porque la api solo escucha en `127.0.0.1` detrás del proxy
