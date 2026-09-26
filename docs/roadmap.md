# Roadmap

## v1 — Herramientas (MVP)

- [x] Landing pública con grid de todas las herramientas (blur en premium)
- [x] Login con Google (Auth.js)
- [x] Detalle de herramienta: video + prompt copiable
- [x] Free tier: 2 unlocks por mes (via `month_key`)
- [x] Suscripción MP Preapproval (4.000 ARS/mes) — código listo, falta probarla contra MP sandbox
- [x] Webhook MP para activar/renovar/cancelar — ídem
- [x] Dashboard básico: perfil, suscripción, unlocks del mes
- [x] Admin: alta de herramientas — resuelto directamente con el panel `/admin` (rol `admin` en `users`)
- [x] Deploy en producción (VPS + Cloudflare Tunnel, deploy automático desde `main`)

**Criterio de done**: puedo publicar una herramienta desde consola. Un usuario nuevo puede loguearse, ver el grid, desbloquear 2 gratis, pagar la suscripción, y desbloquear ilimitado desde ahí.

**Estado (2026-09-26)**: todo construido y en producción; el criterio de done todavía no se
cumple porque falta pagar de punta a punta contra MP sandbox. Además, para abrirlo al público
falta pasar la pantalla de consentimiento de Google a "producción" y cargar las herramientas
reales. El detalle vive en `TODO.md`.

## v2 — Cursos

- [x] Tablas `courses` / `modules` / `lessons` / `progress`
- [x] Progreso por lección (visto / no visto) — falta el % de video
- [x] Landing `/cursos` con temario visible sin login
- [x] Suscripción da acceso a todo (cursos + herramientas ilimitadas)
- [ ] Certificado de completado (PDF descargable)

## v3 — Comunidad y creación

- [ ] Comentarios en herramientas (solo suscriptores)
- [ ] Colecciones / rutas de aprendizaje curadas
- [x] Admin UI para crear contenido sin tocar código (adelantado a v1: `/admin`)
- [ ] Newsletter integrada (probablemente Resend)
- [ ] Analytics propias: qué se desbloquea más, retención

## Fuera de scope de v1 (a propósito)

- Múltiples proveedores OAuth (solo Google)
- Precios en otras monedas (solo ARS)
- Plan anual con descuento
- Refunds / prorateo (MP no lo simplifica)
- App móvil (la API queda lista para eso, pero no se construye)
- Modo claro (fase 2)
