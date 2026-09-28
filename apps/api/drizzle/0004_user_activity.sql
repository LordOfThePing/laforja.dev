CREATE TABLE "user_activity" (
	"user_id" uuid NOT NULL,
	"month_key" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_activity_user_id_month_key_pk" PRIMARY KEY("user_id","month_key")
);
--> statement-breakpoint
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_activity_month_idx" ON "user_activity" USING btree ("month_key");--> statement-breakpoint
-- Backfill con lo que ya había: mes de alta, desbloqueos y progreso (hora de Argentina, como month_key).
INSERT INTO "user_activity" ("user_id", "month_key", "first_seen_at")
SELECT "user_id", "month_key", min("at") FROM (
	SELECT "id" AS "user_id", to_char("created_at" AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') AS "month_key", "created_at" AS "at" FROM "users"
	UNION ALL
	SELECT "user_id", "month_key", "unlocked_at" FROM "unlocks"
	UNION ALL
	SELECT "user_id", to_char("updated_at" AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), "updated_at" FROM "progress"
	UNION ALL
	SELECT "user_id", to_char("completed_at" AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), "completed_at" FROM "progress" WHERE "completed_at" IS NOT NULL
) AS "a"
GROUP BY "user_id", "month_key";
