# Despliegue en VPS

## Estructura

- **Nginx** en el host (fuera de Docker) — TLS + reverse proxy
- **Docker Compose** con `web` + `api` + `postgres`
- **Certbot** para HTTPS con Let's Encrypt (renovación auto)

## docker-compose.yml

El archivo real está en la raíz del repo (`docker-compose.yml`). Servicios:

| Servicio | Imagen | Qué hace |
|---|---|---|
| `postgres` | `postgres:16-alpine` | DB, volumen `pg_data`, healthcheck `pg_isready` |
| `migrate` | `laforja-api` | one-shot: `bun run db:migrate` (migraciones de `apps/api/drizzle/` con drizzle-orm, sin drizzle-kit) |
| `api` | `laforja-api` | Hono sobre Bun, `127.0.0.1:4000`; arranca solo si `migrate` terminó bien |
| `web` | `apps/web/Dockerfile` | build con Bun, runtime Node 22 (`dist/server/entry.mjs`), `127.0.0.1:3000` |

Variables: `.env` en la raíz, ver `.env.example`. Compose falla al arrancar si
falta alguna obligatoria (`DB_PASSWORD`, `AUTH_SECRET`, `MP_ACCESS_TOKEN`,
`MP_WEBHOOK_SECRET`, `FRONTEND_URL`).

Los puertos quedan en `127.0.0.1`: al host solo llega el reverse proxy
(Nginx hoy, Cloudflare Tunnel cuando se haga esa tarea).

## Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name academia.flynnpedroa.engineer;

    ssl_certificate     /etc/letsencrypt/live/academia.flynnpedroa.engineer/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/academia.flynnpedroa.engineer/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /webhooks/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen 80;
    server_name academia.flynnpedroa.engineer;
    return 301 https://$host$request_uri;
}
```

## DNS

- Registro `A` `academia.flynnpedroa.engineer` → IP del VPS
- Cuando migres a `laforja.dev`:
  1. Registro A del nuevo dominio → misma IP
  2. Certificado con `certbot --nginx -d laforja.dev -d www.laforja.dev`
  3. Cambiar `server_name` en Nginx
  4. Redirect 301 desde el subdominio viejo al nuevo (opcional pero recomendado)

## HTTPS (primera vez)

```bash
sudo certbot --nginx -d academia.flynnpedroa.engineer
# la renovación auto ya queda configurada por el paquete
```

## Deploy con el Makefile

El `Makefile` de la raíz maneja el VPS por SSH. Correrlo desde Git Bash
(`make help` lista todo).

### Requisitos (tarea "VPS Hetzner" del TODO)

- Alias SSH `laforja` en `~/.ssh/config` que entre como el usuario `deploy`
  (se puede cambiar con `SSH_HOST=...`)
- `deploy` en el grupo `docker`, dueño de `/opt/laforja` (idealmente `chmod 750`,
  porque ahí vive el `.env` con secretos)
- Acceso de lectura del VPS al repo de GitHub (deploy key), para `make setup`
  y el `git pull` de `make deploy`

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
