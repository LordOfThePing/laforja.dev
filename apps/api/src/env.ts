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
};
