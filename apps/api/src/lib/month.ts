// El cupo mensual se resetea a medianoche de Argentina, no de UTC: si no, un usuario
// que desbloquea el 31 a las 22 hs vería el cupo reiniciado antes de tiempo.
const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

export function monthKey(date: Date = new Date()): string {
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}
