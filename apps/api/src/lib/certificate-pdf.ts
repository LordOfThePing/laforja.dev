import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

export type CertificateData = {
  id: string;
  recipientName: string;
  courseTitle: string;
  issuedAt: Date;
  verifyUrl: string;
};

// Nombre y curso van con la serif de la marca embebida: las fuentes estándar de PDF solo
// cubren WinAnsi y revientan con nombres como "Łukasz". Los textos fijos sí son WinAnsi.
const fonts = {
  serif: Bun.file(new URL('../assets/fonts/InstrumentSerif-Regular.ttf', import.meta.url)),
  serifItalic: Bun.file(new URL('../assets/fonts/InstrumentSerif-Italic.ttf', import.meta.url)),
};

const INK = rgb(0.1, 0.09, 0.08);
const DIM = rgb(0.42, 0.4, 0.38);
const EMBER = rgb(1, 0.478, 0);
const PAPER = rgb(0.985, 0.972, 0.95);

// A4 apaisado, en puntos.
const WIDTH = 842;
const HEIGHT = 595;

function centered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = INK, maxWidth = 640) {
  let fitted = size;
  while (fitted > 12 && font.widthOfTextAtSize(text, fitted) > maxWidth) fitted -= 1;
  const width = font.widthOfTextAtSize(text, fitted);
  page.drawText(text, { x: (WIDTH - width) / 2, y, size: fitted, font, color });
}

function spaced(text: string): string {
  return text.split('').join(' ');
}

export function formatIssuedDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}

export async function renderCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Certificado — ${data.courseTitle}`);
  pdf.setAuthor('La Forja');
  pdf.setSubject(`Certificado de finalización de ${data.recipientName}`);
  pdf.setCreationDate(data.issuedAt);

  const [serif, serifItalic, sans, sansBold, mono] = await Promise.all([
    pdf.embedFont(await fonts.serif.bytes(), { subset: true }),
    pdf.embedFont(await fonts.serifItalic.bytes(), { subset: true }),
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.Courier),
  ]);

  const page = pdf.addPage([WIDTH, HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, color: PAPER });
  page.drawRectangle({ x: 24, y: 24, width: WIDTH - 48, height: HEIGHT - 48, borderColor: EMBER, borderWidth: 1.5 });
  page.drawRectangle({ x: 32, y: 32, width: WIDTH - 64, height: HEIGHT - 64, borderColor: EMBER, borderWidth: 0.5, opacity: 0, borderOpacity: 0.5 });

  centered(page, spaced('LA FORJA'), 500, sansBold, 11, EMBER);
  centered(page, 'Certificado de finalización', 440, serifItalic, 44);
  page.drawLine({ start: { x: WIDTH / 2 - 40, y: 418 }, end: { x: WIDTH / 2 + 40, y: 418 }, thickness: 1, color: EMBER });

  centered(page, 'Se certifica que', 380, sans, 12, DIM);
  centered(page, data.recipientName, 330, serif, 42);
  centered(page, 'completó el curso', 290, sans, 12, DIM);
  centered(page, data.courseTitle, 245, serifItalic, 30);

  centered(page, formatIssuedDate(data.issuedAt), 170, sans, 12);
  page.drawLine({ start: { x: WIDTH / 2 - 90, y: 162 }, end: { x: WIDTH / 2 + 90, y: 162 }, thickness: 0.5, color: DIM });
  centered(page, 'Fecha de emisión', 148, sans, 9, DIM);

  centered(page, 'Verificá este certificado en', 84, sans, 8, DIM);
  centered(page, data.verifyUrl, 70, mono, 8, INK, 700);

  return pdf.save();
}
