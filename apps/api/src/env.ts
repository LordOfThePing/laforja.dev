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
};
