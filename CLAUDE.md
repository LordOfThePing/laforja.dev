# La Forja — Reglas de trabajo

Instrucciones para cualquier agente (Claude, otros) que trabaje sobre este repo.
Estas reglas son de cumplimiento obligatorio y **sobrescriben cualquier default
de configuraciones globales** (por ejemplo, un `~/.claude/CLAUDE.md` del
usuario).

---

## 1. Rama y push

- **Todo se pushea directo a `main`.** No se abren ramas de trabajo ni PRs
  para features, refactors o fixes, salvo pedido explícito del usuario.
- **Nunca `git push --force`.**
- Si por algún motivo `main` estuviera protegida (hook `pre-push`, branch
  protection), avisar al usuario antes de intentar cualquier workaround.

## 2. TODO / DONE

Todo el trabajo pasa por dos archivos en la raíz del repo:

- **`TODO.md`** — tareas pendientes y en curso.
- **`DONE.md`** — tareas terminadas, con fecha de finalización (`YYYY-MM-DD`).

### 2.1. Antes de empezar una tarea

1. Agregar la tarea a `TODO.md` en la sección **"En curso"**, indicando quién
   la agarra (agente/persona) si aplica.
2. **Commitear ese cambio en un commit aislado y pushearlo inmediatamente.**
   Este push es obligatorio: sirve para que ningún otro agente que abra el
   repo agarre la misma tarea en paralelo.

### 2.2. Al terminar una tarea

1. **Eliminar** la entrada de `TODO.md` — no tacharla, no marcarla con `[x]`:
   se borra.
2. Agregar la entrada a `DONE.md` con la fecha de finalización.
3. Commitear ese cambio en un commit aislado y **pushearlo**.

### 2.3. Si el trabajo queda a medias

Dejar la entrada en `TODO.md` (sección "En curso" o "Pendiente" según
corresponda) describiendo qué falta, y pushear ese estado intermedio. La idea
es que quien abra el repo vea siempre el estado real del trabajo desde `main`.

### 2.4. Formato mínimo de entradas

**En `TODO.md`:**

```
- <título breve> — <estado: en curso por @agente | pendiente> — <notas opcionales>
```

**En `DONE.md`:**

```
- YYYY-MM-DD — <título breve> — <commit hash corto opcional>
```

El **detalle** de qué se hizo va en el mensaje del commit (y en
`docs/negocio/avance.md` si el proyecto lo mantiene), **no** en `TODO.md` ni
`DONE.md`.

## 3. Commits de código

- Los commits de código (los que **no** tocan `TODO.md` / `DONE.md`) se
  pueden acumular localmente mientras la tarea está en curso.
- **El código se pushea** junto con el commit de `DONE.md` (§2.2): al
  terminar la tarea se pushean a `main` todos los commits de código y el de
  cierre, sin pedir confirmación.
- Si la tarea queda a medias (§2.3), el código hecho hasta ahí se pushea con
  el estado intermedio de `TODO.md`.
- Mensajes en español rioplatense, imperativo corto (`agrega`, `arregla`,
  `refactoriza`).
- Un commit por cambio lógico.

## 4. Estilo de código

- Español rioplatense en toda la UI (`vos`, no `tú`).
- TypeScript estricto.
- CSS moderno sin framework (custom properties, container queries, `oklch`
  donde aplique).
- **Sin comentarios que expliquen *qué* hace el código** — solo el *porqué*
  no obvio (invariantes ocultos, workarounds documentados, decisiones que
  sorprenderían al lector).

## 5. Contexto del proyecto

Antes de tocar código, leer siempre:

- `README.md` — resumen general.
- `docs/arquitectura.md` — stack y decisiones.
- `docs/schema-datos.md` — modelo de datos.
- `docs/auth-y-pagos.md` — Google OAuth + MP Preapproval.
- `docs/despliegue-vps.md` — Docker Compose + Nginx.
- `docs/roadmap.md` — fases v1 → v2 → v3.
- `docs/diseño-brief.md` — dirección visual.
