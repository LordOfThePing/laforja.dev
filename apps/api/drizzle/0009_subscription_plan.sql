CREATE TYPE "public"."subscription_plan" AS ENUM('basic', 'pro');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_plan" "subscription_plan";--> statement-breakpoint
-- Suscripciones existentes (del modelo viejo de un solo plan) heredan 'pro' = acceso total.
UPDATE "users" SET "subscription_plan" = 'pro' WHERE "subscription_plan" IS NULL AND "subscription_status" IN ('active', 'paused', 'cancelled');
