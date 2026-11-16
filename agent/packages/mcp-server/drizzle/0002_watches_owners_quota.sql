CREATE TABLE IF NOT EXISTS "watches" (
  "id" text PRIMARY KEY,
  "addr" text NOT NULL,
  "owner_key" text NOT NULL,
  "agent_id" text,
  "webhook_url" text,
  "watched_until" timestamptz NOT NULL,
  "next_poll_at" timestamptz NOT NULL,
  "idem_key" text NOT NULL,
  "args_hash" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "watches_owner_idem" ON "watches" ("owner_key", "idem_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watches_next_poll" ON "watches" ("next_poll_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watches_addr" ON "watches" ("addr");
--> statement-breakpoint
ALTER TABLE "mcp_endpoints" ADD COLUMN IF NOT EXISTS "owner_key" text;
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN IF NOT EXISTS "quota_key" text;
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN IF NOT EXISTS "authenticated" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_calls_quota_ts" ON "agent_calls" ("quota_key", "ts");
