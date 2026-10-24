CREATE TABLE "plan_prices" (
	"plan" "subscription_plan" NOT NULL,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_plan_currency_pk" PRIMARY KEY("plan","currency"),
	CONSTRAINT "plan_prices_currency_ck" CHECK ("plan_prices"."currency" in ('ARS', 'USD')),
	CONSTRAINT "plan_prices_amount_ck" CHECK ("plan_prices"."amount" > 0)
);--> statement-breakpoint
-- Los montos que estaban hardcodeados hasta ahora, en centavos.
INSERT INTO "plan_prices" ("plan", "currency", "amount") VALUES
	('basic', 'ARS', 699900),
	('pro', 'ARS', 1999900),
	('basic', 'USD', 700),
	('pro', 'USD', 2000);
