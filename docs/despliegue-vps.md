# Despliegue en VPS

## Estructura

- **Docker Compose** con `postgres` + `migrate` + `api` + `web` + `cloudflared`
- **Cloudflare Tunnel** (`cloudflared` dentro del compose) como única entrada
  pública: TLS lo termina Cloudflare, el VPS no abre puertos ni maneja
  certificados. Mismo patrón que los otros proyectos del VPS.

## docker-compose.yml

El archivo real está en la raíz del repo (`docker-compose.yml`). Servicios:

| Servicio | Imagen | Qué hace |
|---|---|---|
| `postgres` | `postgres:16-alpine` | DB, volumen `pg_data`, healthcheck `pg_isready` |
| `migrate` | `laforja-api` | one-shot: `bun run db:migrate` (migraciones de `apps/api/drizzle/` con drizzle-orm, sin drizzle-kit) |
| `api` | `laforja-api` | Hono sobre Bun, `127.0.0.1:4000`; arranca solo si `migrate` terminó bien |
| `web` | `apps/web/Dockerfile` | build con Bun, runtime Node 22 (`dist/server/entry.mjs`), `127.0.0.1:3000` |
| `cloudflared` | `cloudflare/cloudflared` | solo con `COMPOSE_PROFILES=tunnel`; conecta el tunnel con `CLOUDFLARE_TUNNEL_TOKEN` |

Variables: `.env` en la raíz, ver `.env.example`. Compose falla al arrancar si
falta alguna obligatoria (`DB_PASSWORD`, `AUTH_SECRET`, `MP_ACCESS_TOKEN`,
`MP_WEBHOOK_SECRET`, `FRONTEND_URL`).

`web` y `api` publican en `127.0.0.1` (`WEB_PORT` / `API_PORT`) solo para
debug con `curl` desde el VPS; el tráfico real entra por `cloudflared`, que les
habla por la red interna de Docker.

## Cloudflare Tunnel

### Crear el tunnel (una vez, en el panel de Cloudflare)

1. Zero Trust → Networks → Tunnels → **Create a tunnel** → tipo *Cloudflared*,
   nombre `laforja`.
2. Copiar el **token** del comando de instalación (lo que va después de
   `--token`) y ponerlo en `.env.production`:
   ```env
   COMPOSE_PROFILES=tunnel
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   ```
   No hace falta instalar nada en el VPS: `cloudflared` corre en el compose.
3. **Public hostnames**, en este orden (Cloudflare usa el primero que matchea):

   | Hostname | Path | Service |
   |---|---|---|
   | `academia.flynnpedroa.engineer` | `/api/auth/*` | `http://web:3000` |
   | `academia.flynnpedroa.engineer` | `/api/*` | `http://api:4000` |
   | `academia.flynnpedroa.engineer` | `/webhooks/*` | `http://api:4000` |
   | `academia.flynnpedroa.engineer` | *(vacío)* | `http://web:3000` |

   **`/api/auth/*` tiene que ir primero**: es Auth.js de la web, no la api. Si
   cae en la api, el login con Google se rompe.

   Cloudflare crea solo el registro DNS (CNAME al tunnel). Si había un registro
   `A` para ese hostname apuntando al VPS, borrarlo.

### Qué agrega Cloudflare en cada request

- `cf-connecting-ip`: IP real del cliente. La api la usa para el rate limit del
  webhook de MP.
- `x-forwarded-proto: https`: Auth.js arma las URLs de callback con https
  (`trustHost: true` en `apps/web/auth.config.ts`).

### Google OAuth

En Google Cloud Console → Credentials → el OAuth client de La Forja:
- Authorized JavaScript origin: `https://academia.flynnpedroa.engineer`
- Authorized redirect URI: `https://academia.flynnpedroa.engineer/api/auth/callback/google`

### Webhook de MercadoPago

En el panel de MP → Webhooks: URL
`https://academia.flynnpedroa.engineer/webhooks/mercadopago`, eventos
*Planes y suscripciones*. La clave secreta que muestra MP va en
`MP_WEBHOOK_SECRET`.

### Migrar a `laforja.dev` (más adelante)

Agregar los mismos public hostnames con `laforja.dev` en el mismo tunnel,
actualizar `FRONTEND_URL`, el callback de Google y la URL del webhook de MP.
Redirect 301 desde el dominio viejo con una Redirect Rule de Cloudflare.

## Deploy con el Makefile

El `Makefile` de la raíz maneja el VPS por SSH (`make help` lista todo). En
Windows se puede correr desde PowerShell o cmd: las recetas usan el bash de Git
for Windows (`C:/Program Files/Git/usr/bin`; si está en otro lado,
`make GIT_BIN=... <target>`).

### VPS (ya configurado el 2026-09-25)

Hetzner `91.98.23.236` (Ubuntu 24.04), compartido con otros proyectos
(`crm`, `poligiros`, `vuelto`, `n8n`, …), cada uno con su usuario `deploy-*`.

- Usuario **`deploy-laforja`**: grupo `docker`, sin sudo ni password, solo
  entra por clave. Lo crea `scripts/vps-setup.sh` (idempotente), corrido como root:
  ```bash
  ssh hetzner 'bash -s' -- "\"$(cat ~/.ssh/id_ed25519.pub)\"" < scripts/vps-setup.sh
  ```
- **`/opt/laforja`**: dueño `deploy-laforja`, `750` (ahí vive el `.env`)
- Alias SSH local **`laforja`** en `~/.ssh/config` → `deploy-laforja@91.98.23.236`
  (el Makefile lo usa por default; se cambia con `SSH_HOST=...`)
- El repo es público: el VPS clona por HTTPS, no hace falta deploy key
- **Puertos del host ocupados** por otros proyectos: `3000`, `3100`, `5432`,
  `5435`, `5678`, `8080`, `27017`. En el `.env.production` poner
  `WEB_PORT=3200` (y `API_PORT` si hiciera falta); Postgres no se publica al host

### Primera vez

```bash
cp .env.example .env.production   # completar con valores de producción (está en .gitignore)
make setup                        # clona el repo en /opt/laforja
make env-push                     # scp de .env.production → /opt/laforja/.env (600)
make deploy                       # pull + build + up; migrate corre solo antes de api
make seed                         # carga categorías y herramientas
```

### Día a día

| Comando | Qué hace |
|---|---|
| `make deploy` | Falla si tu `HEAD` no está pusheado a `origin/main` (el VPS deploya lo que hay en GitHub). Después: `git pull --ff-only` + `docker compose up -d --build --wait` |
| `make env-push` | Sube `.env.production` (o `ENV_FILE=...`). Después correr `make up` o `make deploy` para que los contenedores lo tomen |
| `make env-diff` | Compara solo los **nombres** de variables local vs VPS, sin mostrar valores |
| `make logs [SERVICE=api]` | Sigue los logs |
| `make ps` / `up` / `down` / `restart SERVICE=api` | Manejo de contenedores |
| `make migrate` / `make seed` | Migraciones / seed a mano |
| `make psql` / `make shell SERVICE=api` | Consola en la DB o en un contenedor |

Local: `make dev-up`, `make dev-seed`, `make dev-down`, `make test`.
