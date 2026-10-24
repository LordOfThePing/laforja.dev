import { parseAdminEmails } from './auth.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  authSecret: required('AUTH_SECRET'),
  mpAccessToken: required('MP_ACCESS_TOKEN'),
  mpWebhookSecret: required('MP_WEBHOOK_SECRET'),
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
  // 0 la desactiva.
  reconcileIntervalHours: Number(process.env.RECONCILE_INTERVAL_HOURS ?? 6),
  // Sin esto el panel muestra que los backups no se pueden ver desde acá (por ejemplo, en local).
  backupStateDir: process.env.BACKUP_STATE_DIR || undefined,
  // Sin key la newsletter queda apagada. El remitente tiene que ser de un dominio verificado en Resend.
  resendApiKey: process.env.RESEND_API_KEY || undefined,
  newsletterFrom: process.env.NEWSLETTER_FROM || 'La Forja <newsletter@laforja.dev>',
  // Bearer token del server MCP en /mcp (ABM de herramientas/categorías desde Claude Code u otro cliente).
  // Vacío = MCP apagado. En prod, bindear el puerto a 127.0.0.1 o poner un token largo y aleatorio.
  mcpAdminToken: process.env.MCP_ADMIN_TOKEN || undefined,
  // Stripe (internacional en USD). Sin estas cuatro variables, el provider queda apagado:
  // /api/subscription/create con provider='stripe' responde 503 provider_disabled.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || undefined,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
  stripePriceBasic: process.env.STRIPE_PRICE_BASIC || undefined,
  stripePricePro: process.env.STRIPE_PRICE_PRO || undefined,
};
