CREATE TYPE "public"."payment_provider" AS ENUM('mercadopago', 'stripe');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "payment_provider" "payment_provider";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
-- Suscripciones existentes son todas de MP (único provider hasta ahora).
UPDATE "users" SET "payment_provider" = 'mercadopago' WHERE "subscription_id" IS NOT NULL;--> statement-breakpoint
-- La columna pasa a guardar ids de MP (`mp:<id>`) y de Stripe (`stripe:<evt_...>`), prefijados.
ALTER TABLE "subscription_events" RENAME COLUMN "mp_event_id" TO "provider_event_id";--> statement-breakpoint
-- Eventos previos quedan con el id crudo (sin prefijo); el webhook ya acepta reintentos duplicados por el unique.
UPDATE "subscription_events" SET "provider_event_id" = 'mp:' || "provider_event_id" WHERE "provider_event_id" NOT LIKE 'mp:%' AND "provider_event_id" NOT LIKE 'reconcile:%';
