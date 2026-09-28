# Despliegue en VPS

## Estructura

- **Docker Compose** con `postgres` + `migrate` + `api` + `web` + `backup` + `cloudflared`
  (+ `umami` para analytics, opcional)
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
| `backup` | `ops/backup/Dockerfile` | `pg_dump` diario + rotación + copia opcional a un bucket (ver [Backups](#backups-de-postgres)) |
| `cloudflared` | `cloudflare/cloudflared` | solo con `COMPOSE_PROFILES=tunnel`; conecta el tunnel con `CLOUDFLARE_TUNNEL_TOKEN` |
| `umami-db` | `postgres:16-alpine` | solo con el profile `analytics`; one-shot: crea el rol y la base `umami` en el mismo Postgres |
| `umami` | `ghcr.io/umami-software/umami` | solo con el profile `analytics`; analytics de tráfico, panel en `127.0.0.1:3300` (ver [Analytics](#analytics-umami)) |

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

## Monitoreo de uptime

`.github/workflows/uptime.yml` corre cada 5 minutos (GitHub puede atrasarlo
algunos minutos) y chequea, desde afuera y pasando por Cloudflare:

| Chequeo | Espera |
|---|---|
| web: `GET /` | 200 y el texto `La Forja` |
| api: `GET /api/health` | 200 y `"ok":true` — la api hace `select 1` contra Postgres (timeout 3 s) y responde 503 si la base no contesta |

`/api/health` existe porque el `/health` de la api (el del healthcheck de
Docker) no sale por el tunnel: sin prefijo `/api` cae en la web.

Cada chequeo se reintenta 4 veces con 20 s de pausa antes de dar la caída por
buena, para que un deploy (que reinicia contenedores) no dispare alertas.

**Aviso:** si algo falla, el workflow abre un issue con la etiqueta `caida`
(o comenta en el que ya esté abierto) y la corrida queda en rojo. Cuando vuelve
a responder, cierra el issue solo. GitHub avisa por mail de los issues nuevos a
quien *watchea* el repo (el dueño, por default) y de las corridas fallidas de
un `schedule` a quien tocó el cron por última vez.

- Probarlo a mano: pestaña *Actions* → *Uptime* → *Run workflow*
- URL chequeada: variable del repo `SITE_URL` (Settings → Secrets and
  variables → Actions → *Variables*); sin ella usa
  `https://academia.flynnpedroa.engineer`
- GitHub desactiva los workflows con `schedule` si el repo pasa 60 días sin
  commits; si pasa, se reactiva desde la pestaña *Actions*

## Backups de Postgres

El servicio `backup` del compose (imagen en `ops/backup/`) hace un `pg_dump`
en formato custom **una vez por día**: cada minuto se fija si hay un dump de las
últimas ~23 h y si no, lo hace. Un deploy o un reinicio no saltea ni duplica
días, y el primer backup sale apenas el servicio arranca. Al arrancar loguea si
ya había uno reciente y si la copia fuera del VPS está activada.

En el panel, **Admin → Backups** muestra el último backup (y el error si falló),
si se copió al bucket, los dumps del VPS y la configuración, y tiene un botón
«Hacer backup ahora». El servicio deja ese estado en el volumen `backup_state`,
que la API monta sin ver los dumps ni las credenciales; el botón deja un archivo
`request` que el servicio toma en menos de un minuto.

- Los dumps quedan en el volumen `pg_backups` (`/backups/laforja-<fecha UTC>.dump`)
  y se borran a los `BACKUP_KEEP_DAYS` días (default 14)
- Si falla, lo loguea (`make logs SERVICE=backup`) y reintenta a la hora

### Copia fuera del VPS

El volumen vive en el mismo disco que la base: si se pierde el VPS, se pierden
los dos. Hay dos formas de tener una copia afuera, combinables:

1. **Bucket S3-compatible (automático).** Con `BACKUP_S3_BUCKET` y las
   credenciales en el `.env` (ver `.env.example`), cada dump se sube con rclone
   y en el bucket se aplica la misma rotación. Con Cloudflare R2: crear el
   bucket, después *R2 → Manage API tokens* → token con permiso **Object
   Read & Write** solo sobre ese bucket; el endpoint es
   `https://<account_id>.r2.cloudflarestorage.com` y `BACKUP_S3_PROVIDER=Cloudflare`.
   Después `make env-push` + `make up`.
2. **`make backup-pull` (a mano).** Baja el último dump a `./backups/` de tu
   máquina (está en `.gitignore`) y verifica el sha256 contra el del VPS.

### Comandos

| Comando | Qué hace |
|---|---|
| `make backup` | Hace un backup ahora (por ejemplo, antes de una migración delicada) |
| `make backups` | Lista los dumps del VPS |
| `make backup-pull` | Baja el último dump a `./backups/` |

### Restaurar

Parar lo que escribe en la base, restaurar y volver a levantar. `--clean`
borra y recrea los objetos que están en el dump. Desde `/opt/laforja` en el VPS:

```bash
docker compose stop api web
# Un dump que ya está en el VPS (nombre de `make backups`):
docker compose exec -T backup pg_restore --clean --if-exists --no-owner -d laforja /backups/laforja-XXXX.dump
docker compose start api web
```

Desde un dump en tu máquina, el mismo `pg_restore` leyendo de stdin:

```bash
ssh -o RemoteCommand=none laforja \
  "cd /opt/laforja && docker compose exec -T backup pg_restore --clean --if-exists --no-owner -d laforja" \
  < backups/laforja-XXXX.dump
```

Para mirar un dump sin tocar producción: restaurarlo en una base aparte
(`createdb -U laforja prueba` en el contenedor `postgres` y `-d prueba`).

## Analytics (Umami)

Tráfico del sitio con [Umami](https://umami.is) self-hosted, sin script en el
browser: el **middleware de la web** (`apps/web/src/lib/analytics.ts`) le manda
cada pageview a `http://umami:3000/api/send` por la red interna, sin esperar la
respuesta. No hay cookies ni identificador persistente (Umami arma el visitante
con IP + user-agent + un salt que rota), no hace falta tocar la CSP y los
bloqueadores de anuncios no lo cortan.

- Cuenta solo `GET` que devuelven HTML con 200. Saltea `/admin`, `/api/`, las
  imágenes OG, `robots.txt`, `sitemap.xml` y los prefetch (`Sec-Purpose: prefetch`)
- De la URL manda el path y los `utm_*`; el resto del query (ids de MP, etc.)
  no sale. Del referer, sin query
- IP y país salen de `cf-connecting-ip` / `cf-ipcountry` (los pone Cloudflare).
  Umami descarta los bots por user-agent
- Sin `UMAMI_WEBSITE_ID`, o con Umami caído, la web sigue igual y no manda nada
- La base `umami` vive en el mismo Postgres con su propio rol, pero **el backup
  diario no la incluye** (solo dumpea `laforja`): perderla es perder métricas,
  no datos de usuarios

### Activarlo (una vez)

1. En `.env.production`: `COMPOSE_PROFILES=tunnel,analytics`,
   `UMAMI_DB_PASSWORD` y `UMAMI_APP_SECRET` (`openssl rand -hex 24`; la
   password va dentro de una URL, así que nada de `@ : / #`).
2. `make env-push` + `make up`. `umami-db` crea el rol y la base (es
   idempotente: en cada `up` vuelve a fijar la password) y `umami` corre sus
   migraciones al arrancar.
3. `make stats` abre un túnel SSH: entrar a `http://localhost:3300` con
   `admin` / `umami` y **cambiar la password** (Settings → Profile).
4. Settings → Websites → *Add website* con el dominio del sitio. Copiar el
   *Website ID* a `UMAMI_WEBSITE_ID`, y `make env-push` + `make up` de nuevo.

El panel no sale por el tunnel de Cloudflare: se entra siempre con `make stats`.

## Deploy con el Makefile

El `Makefile` de la raíz maneja el VPS por SSH (`make help` lista todo). En
Windows se puede correr desde PowerShell o cmd: las recetas usan el bash de Git
for Windows (`C:/Program Files/Git/usr/bin`; si está en otro lado,
`make GIT_BIN=... <target>`).

También se puede correr **dentro del VPS**, parado en `/opt/laforja`
(`ssh laforja` ya entra ahí): los mismos targets (`deploy`, `ps`, `logs`, …)
corren directo sin SSH. `env-push` y `env-diff` solo tienen sentido desde tu
máquina. Fuera de ese directorio se fuerza con `ON_VPS=1`.

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
  (el Makefile lo usa por default; se cambia con `SSH_HOST=...`). Abre una
  shell en `/opt/laforja`; el Makefile anula ese `RemoteCommand` con
  `-o RemoteCommand=none`:
  ```
  Host laforja
    HostName 91.98.23.236
    User deploy-laforja
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    RequestTTY yes
    RemoteCommand cd /opt/laforja && exec bash -l
  ```
- **SSH solo por clave** (todo el VPS, desde el 2026-09-26):
  `/etc/ssh/sshd_config.d/00-hardening.conf` pone `PasswordAuthentication no`
  y `KbdInteractiveAuthentication no`. Tiene que llamarse `00-…` para ganarle a
  `50-cloud-init.conf`, que pone `yes` (sshd se queda con el primer valor que
  lee). Verificar con `sshd -T | grep passwordauthentication`
- El repo es público: el VPS clona por HTTPS, no hace falta deploy key
- **Puertos del host ocupados** por otros proyectos: `3000`, `3100`, `5432`,
  `5435`, `5678`, `8080`, `27017`. En el `.env.production` poner
  `WEB_PORT=3200` (y `API_PORT` si hiciera falta); Postgres no se publica al host

### Deploy automático (GitHub Actions)

`.github/workflows/deploy.yml` deploya en cada push a `main` (ignora commits que
solo tocan `*.md` o `docs/`) y también se puede lanzar a mano desde la pestaña
*Actions* (`workflow_dispatch`). Los deploys van de a uno (`concurrency`).

El workflow entra como `deploy-laforja` con una clave propia, **atada a un solo
comando** en `authorized_keys`:
`command="/usr/local/bin/laforja-deploy",restrict ssh-ed25519 … github-actions-laforja`.
Lo que sea que pida el cliente se ignora: siempre corre ese script (copia de
`scripts/ci-deploy.sh`, dueño root, fuera del checkout), que hace `git pull
--ff-only` + `docker compose up -d --build --wait` con un `flock` contra deploys
simultáneos. Si la clave se filtra, lo único que permite es redeployar
`origin/main`.

Secrets del repo (Settings → Secrets and variables → Actions):

| Secret | Valor |
|---|---|
| `VPS_SSH_KEY` | clave privada `~/.ssh/laforja-gha` (entera, con las líneas `BEGIN`/`END`) |
| `VPS_KNOWN_HOSTS` | `91.98.23.236 ssh-ed25519 AAAA…` (host key del VPS, sacada de `/etc/ssh/ssh_host_ed25519_key.pub` por `ssh hetzner`, no por `ssh-keyscan`) |

Instalar o rotar la clave y el script (como root, idempotente):

```bash
ssh-keygen -t ed25519 -N '' -C github-actions-laforja -f ~/.ssh/laforja-gha
ssh hetzner 'cat > /root/laforja-deploy.sh' < scripts/ci-deploy.sh
ssh hetzner 'bash -s' -- "\"$(cat ~/.ssh/laforja-gha.pub)\"" < scripts/vps-ci-setup.sh
```

Si se cambia `scripts/ci-deploy.sh`, hay que reinstalarlo con los dos comandos
de `ssh hetzner`: el VPS no lo toma del repo.

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
| `make stats` | Túnel SSH al panel de Umami (`http://localhost:3300`) |

Local: `make dev-up`, `make dev-seed`, `make dev-down`, `make test`.
