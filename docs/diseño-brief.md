# Brief de diseño para La Forja

Para iterar con `/design-shotgun` y `/design-consultation` cuando esas skills estén disponibles.

## Concepto

Una academia digital para gente que quiere trabajar con agentes de IA en serio. El nombre "La Forja" evoca un taller donde se forjan herramientas — cada herramienta es un prompt o técnica que el usuario puede empuñar en su propio trabajo.

## Audiencia

- Devs, PMs, diseñadores y makers hispanohablantes
- Ya usan ChatGPT / Claude a nivel básico y buscan subir de nivel
- Están dispuestos a pagar por curaduría de calidad
- Estéticamente aprecian marcas como Linear, Vercel, Anthropic, Cursor, Arc Browser

## Personalidad de marca

- **Vanguardista** pero con calor humano
- **Agéntica** — la IA se siente co-protagonista, no un truco
- **Curada** — el opuesto de un dump de prompts en Notion
- **Confiable** — se ve que hay criterio detrás

## Direcciones visuales a explorar

### A — "Forja moderna" (elegida para el bootstrap)
Metáfora del taller de forjado interpretada con estética moderna. Negro profundo + naranja/ámbar (fuego). Tipografía serif elegante para display. Sensación de artesanía + tecnología. Referencias: Anthropic, Arc Browser, Superhuman.

### B — "Terminal agéntico"
Estética de terminal moderno + agente. Fondo oscuro, tipografía mono para todo, acentos verdes/cyan. Muy "para devs". Referencias: Vercel, Linear, Cursor, Fly.io.

### C — "Editorial premium"
Menos "tech dark", más revista de tecnología premium. Fondo crema/off-white, tipografía serif grande, mucho whitespace. Referencias: Every.to, Stripe Press, Kinopio.

## Componentes clave a diseñar

1. **Hero landing** — headline + CTA + preview del grid
2. **Grid de herramientas** — cards con blur/lock en premium
3. **Detalle de herramienta** — video, prompt copiable, metadata
4. **Paywall / pricing** — comparación clara free vs suscriptor
5. **Nav** — sticky, translucent, logo + login
6. **Dashboard usuario** — perfil, suscripción, historial

## Restricciones técnicas

- Astro + React islands: preferir CSS moderno sobre JS pesado
- Responsive desde 320px hasta 1920px
- Modo oscuro por default; claro en fase 2
- Accesibilidad: contraste AA, focus visible, keyboard nav

## Copy y tono

- Español rioplatense sin caricatura
- "Vos" no "tú"
- Evitar hype vacío tipo "revoluciona tu workflow"
- Ejemplo: "Prompts que probé, refinée y uso todos los días. Sin humo."
