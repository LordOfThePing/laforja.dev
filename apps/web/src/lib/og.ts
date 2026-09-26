import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import satori from 'satori';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Los archivos se leen de node_modules en runtime (el adapter de Node no bundlea las
// dependencias). Satori no lee woff2, por eso las fuentes salen de @fontsource en .woff.
const require = createRequire(import.meta.url);
const asset = (id: string) => readFile(require.resolve(id));

type Font = { name: string; data: Buffer; weight: 400 | 600; style: 'normal' };

let ready: Promise<Font[]> | null = null;

function load(): Promise<Font[]> {
  ready ??= (async () => {
    const [wasm, serif, inter, interSemi] = await Promise.all([
      asset('@resvg/resvg-wasm/index_bg.wasm'),
      asset('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff'),
      asset('@fontsource/inter/files/inter-latin-400-normal.woff'),
      asset('@fontsource/inter/files/inter-latin-600-normal.woff'),
    ]);
    await initWasm(wasm);
    return [
      { name: 'Instrument Serif', data: serif, weight: 400, style: 'normal' },
      { name: 'Inter', data: inter, weight: 400, style: 'normal' },
      { name: 'Inter', data: interSemi, weight: 600, style: 'normal' },
    ];
  })();
  // Si falla la carga, que el próximo request reintente en vez de quedar con la promesa rechazada.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };

const h = (type: string, style: Record<string, unknown>, children?: unknown, extra = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

const MARK = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="24" y2="24"><stop offset="0" stop-color="#FFB067"/><stop offset="1" stop-color="#FF7A00"/></linearGradient></defs>' +
    '<path d="M4 20 L14 10 M11 7 L17 13 M15 3 L21 9 L17 13" stroke="url(#g)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
).toString('base64')}`;

// Las fuentes son el subset latin, que no trae flechas: sin SVG saldría el glifo de "falta".
const ARROW = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">' +
    '<path d="M4 12 H19 M13 6 L19 12 L13 18" stroke="#FF7A00" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
).toString('base64')}`;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export type OgCard = {
  eyebrow: string;
  title: string;
  description?: string;
  footer: string;
};

export async function renderOgPng(card: OgCard): Promise<Uint8Array> {
  const fonts = await load();
  const title = clip(card.title, 90);
  const tree = h(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '72px 80px',
      backgroundColor: '#0A0908',
      backgroundImage:
        'radial-gradient(ellipse 90% 70% at 50% -10%, rgba(255,122,0,0.30), rgba(255,122,0,0) 70%)',
      color: '#F5F1EA',
      fontFamily: 'Inter',
    },
    [
      h('div', { display: 'flex', alignItems: 'center', gap: 16 }, [
        h('img', { width: 44, height: 44 }, undefined, { src: MARK, width: 44, height: 44 }),
        h('div', { fontFamily: 'Instrument Serif', fontSize: 40 }, 'La Forja'),
      ]),
      h('div', { display: 'flex', flexDirection: 'column', gap: 24 }, [
        h(
          'div',
          { fontSize: 24, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: '#FFB067' },
          card.eyebrow,
        ),
        h(
          'div',
          { fontFamily: 'Instrument Serif', fontSize: title.length > 50 ? 68 : 84, lineHeight: 1.05 },
          title,
        ),
        card.description
          ? h('div', { fontSize: 30, lineHeight: 1.4, color: '#A8A29A' }, clip(card.description, 150))
          : null,
      ].filter(Boolean)),
      h(
        'div',
        {
          display: 'flex',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(245,241,234,0.16)',
          paddingTop: 28,
          fontSize: 24,
          color: '#6B6660',
        },
        [
          h('div', {}, card.footer),
          h('img', { width: 28, height: 28 }, undefined, { src: ARROW, width: 28, height: 28 }),
        ],
      ),
    ],
  );

  // satori tipa el primer argumento como ReactNode; el árbol plano es lo que consume por dentro.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}

export function pngResponse(png: Uint8Array): Response {
  return new Response(Buffer.from(png), {
    headers: {
      'content-type': 'image/png',
      // Cloudflare cachea .png por default; el TTL corto deja que un cambio de título se vea en el día.
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
