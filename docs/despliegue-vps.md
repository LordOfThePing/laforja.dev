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
    }

    location /webhooks/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
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

## Deploy workflow (manual v1)

```bash
ssh vps
cd /opt/laforja
git pull
docker compose up -d --build --wait   # migrate corre solo antes de levantar api
docker compose run --rm api bun run db:seed   # solo la primera vez / al cambiar el seed
```

Automatizable después con el Makefile de deploy (tarea pendiente) o GitHub Actions.
