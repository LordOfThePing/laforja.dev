# Roadmap

## v1 — Herramientas (MVP)

- [ ] Landing pública con grid de todas las herramientas (blur en premium)
- [ ] Login con Google (Auth.js)
- [ ] Detalle de herramienta: video + prompt copiable
- [ ] Free tier: 2 unlocks por mes (via `month_key`)
- [ ] Suscripción MP Preapproval (4.000 ARS/mes)
- [ ] Webhook MP para activar/renovar/cancelar
- [ ] Dashboard básico: perfil, suscripción, unlocks del mes
- [ ] Admin: alta de herramientas vía CLI/seed script (sin UI todavía)

**Criterio de done**: puedo publicar una herramienta desde consola. Un usuario nuevo puede loguearse, ver el grid, desbloquear 2 gratis, pagar la suscripción, y desbloquear ilimitado desde ahí.

## v2 — Cursos

- [ ] Tablas `courses` / `modules` / `lessons` / `progress`
- [ ] Progreso por lección (visto / no visto / % de video)
- [ ] Landing `/cursos` con temario visible sin login
- [ ] Suscripción da acceso a todo (cursos + herramientas ilimitadas)
- [ ] Certificado de completado (PDF descargable)

## v3 — Comunidad y creación

- [ ] Comentarios en herramientas (solo suscriptores)
- [ ] Colecciones / rutas de aprendizaje curadas
- [ ] Admin UI para crear contenido sin tocar código
- [ ] Newsletter integrada (probablemente Resend)
- [ ] Analytics propias: qué se desbloquea más, retención

## Fuera de scope de v1 (a propósito)

- Múltiples proveedores OAuth (solo Google)
- Precios en otras monedas (solo ARS)
- Plan anual con descuento
- Refunds / prorateo (MP no lo simplifica)
- App móvil (la API queda lista para eso, pero no se construye)
- Modo claro (fase 2)
