-- Stripe no acepta cuentas de Argentina: el provider internacional pasa a ser Lemon Squeezy.
-- Stripe nunca se prendió en prod (sin STRIPE_SECRET_KEY), así que no hay filas con 'stripe'
-- ni ids de Stripe que migrar: se renombra en el lugar.
ALTER TYPE "public"."payment_provider" RENAME VALUE 'stripe' TO 'lemonsqueezy';--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "stripe_customer_id" TO "ls_customer_id";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "stripe_subscription_id" TO "ls_subscription_id";
