const ID = /^[\w-]{11}$/;

type EmbedOptions = { jsApi?: boolean; start?: number };

export function youtubeEmbedUrl(url: string | null, { jsApi = false, start }: EmbedOptions = {}): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = parsed.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? null;
  }
  if (!id || !ID.test(id)) return null;
  const params = new URLSearchParams();
  if (jsApi) params.set('enablejsapi', '1');
  if (start && start > 0) params.set('start', String(Math.floor(start)));
  const query = params.toString() ? `?${params}` : '';
  return `https://www.youtube-nocookie.com/embed/${id}${query}`;
}
