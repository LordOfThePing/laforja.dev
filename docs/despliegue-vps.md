# Despliegue en VPS

## Estructura

- **Nginx** en el host (fuera de Docker) — TLS + reverse proxy
- **Docker Compose** con `web` + `api` + `postgres`
- **Certbot** para HTTPS con Let's Encrypt (renovación auto)

## docker-compose.yml (esquema)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - pg_data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: laforja
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: laforja
    networks: [internal]

  api:
    build: ./apps/api
    restart: unless-stopped
    depends_on: [postgres]
    environment:
      DATABASE_URL: postgres://laforja:${DB_PASSWORD}@postgres:5432/laforja
      AUTH_SECRET: ${AUTH_SECRET}
      MP_ACCESS_TOKEN: ${MP_ACCESS_TOKEN}
      MP_WEBHOOK_SECRET: ${MP_WEBHOOK_SECRET}
      FRONTEND_URL: ${FRONTEND_URL}
    ports:
      - "127.0.0.1:4000:4000"
    networks: [internal]

  web:
    build: ./apps/web
    restart: unless-stopped
    depends_on: [api]
    environment:
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_GOOGLE_ID: ${AUTH_GOOGLE_ID}
      AUTH_GOOGLE_SECRET: ${AUTH_GOOGLE_SECRET}
      API_URL: http://api:4000
      PUBLIC_SITE_URL: ${FRONTEND_URL}
    ports:
      - "127.0.0.1:3000:3000"
    networks: [internal]

volumes:
  pg_data:

networks:
  internal:
```

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
docker compose build
docker compose up -d
docker compose exec api bun run drizzle-kit push  # migraciones
```

Automatizable después con GitHub Actions (SSH + `git pull` + `docker compose up -d`).
