// Vite reemplaza import.meta.env.* privadas en el build, así que en la imagen de Docker
// quedarían undefined. process.env se lee en runtime; import.meta.env cubre `astro dev`.
export const serverEnv = (name: string): string | undefined =>
  process.env[name] ?? import.meta.env[name];
