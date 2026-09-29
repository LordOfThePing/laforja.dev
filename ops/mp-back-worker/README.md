# mp-back-worker

Worker de Cloudflare que redirige (302) el `back_url` de MercadoPago a
`https://laforja.dev/dashboard/gracias`, conservando el query string (MP suma
`preapproval_id`). Existe porque MP a veces rechaza el `back_url` cuando el
host no le gusta; ver la variable `MP_BACK_URL` en `.env.example` y la sección
de Webhook en `docs/despliegue-vps.md`.

## Publicar

Una sola vez, desde acá:

```bash
npx wrangler login       # abre el navegador
npx wrangler deploy
```

Sale una URL tipo `https://laforja-mp-back.<tu-subdominio>.workers.dev`.

## Cambiar el destino (opcional)

Por defecto redirige a `https://laforja.dev/dashboard/gracias`. Para apuntarlo
a otro host:

```bash
npx wrangler secret put TARGET_URL
# pegar, p. ej., https://staging.laforja.dev/dashboard/gracias
```

## Enganchar con la API

En `.env.production`, setear:

```
MP_BACK_URL=https://laforja-mp-back.<tu-subdominio>.workers.dev/gracias
```

Y después `make env-push && make deploy` desde local. La ruta después de
`workers.dev` no importa (el Worker toma cualquier path); dejarla `/gracias`
solo por prolijidad en los logs de MP.
