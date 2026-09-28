export const MAX_COMMENT_LENGTH = 2000;

export function parseCommentInput(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const text = (body as Record<string, unknown>).body;
  if (typeof text !== 'string') return null;
  // Normaliza saltos de Windows y colapsa tiradas de líneas vacías: el front separa párrafos
  // por línea en blanco y no queremos comentarios con media pantalla de aire.
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length === 0 || clean.length > MAX_COMMENT_LENGTH) return null;
  return clean;
}

// Los comentarios los ve cualquiera que abra la herramienta: nunca el email, y del nombre
// solo el primero más la inicial del apellido.
export function publicAuthorName(name: string | null): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const [first, ...rest] = parts;
  if (!first) return 'Suscriptor';
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first;
}
