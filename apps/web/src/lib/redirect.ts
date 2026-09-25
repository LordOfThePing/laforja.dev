// Solo paths locales: un `next` absoluto o `//host` convertiría el login en un open redirect.
// `/\` también cuenta porque los browsers lo normalizan a `//`.
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}

export function loginUrl(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}
