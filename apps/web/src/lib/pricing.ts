import { type Currency, type Prices, type Provider, PROVIDER_CURRENCY } from './api';

export type Region = 'ar' | 'intl';

const PREFIX: Record<Currency, string> = { ARS: '$', USD: 'US$' };
const whole = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Montos en centavos (como los guarda la API). Los decimales solo aparecen si los hay: $6.999, US$24,50.
export function formatPrice(amount: number, currency: Currency): string {
  const format = amount % 100 === 0 ? whole : cents;
  return `${PREFIX[currency]}${format.format(amount / 100)}`;
}

// ?region= manda; si no, el país que agrega Cloudflare (CF-IPCountry). Sin Lemon Squeezy es siempre AR.
export function resolveRegion(request: Request, url: URL, prices: Prices | null): Region {
  if (!prices?.providers.lemonsqueezy) return 'ar';
  const param = url.searchParams.get('region');
  if (param === 'ar' || param === 'intl') return param;
  const country = request.headers.get('cf-ipcountry');
  return country && country !== 'AR' && country !== 'XX' ? 'intl' : 'ar';
}

export const REGION_PROVIDER: Record<Region, Provider> = { ar: 'mercadopago', intl: 'lemonsqueezy' };

export function regionCurrency(region: Region): Currency {
  return PROVIDER_CURRENCY[REGION_PROVIDER[region]];
}

export const PROVIDER_LABEL: Record<Provider, string> = { mercadopago: 'MercadoPago', lemonsqueezy: 'Lemon Squeezy' };
