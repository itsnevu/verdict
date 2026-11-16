CREATE TABLE IF NOT EXISTS "tokens" (
  "addr" text PRIMARY KEY,
  "symbol" text,
  "first_seen" timestamptz NOT NULL,
  "last_scanned" timestamptz,
  "webhook_url" text,
  "watched_until" timestamptz,
  "next_poll_at" timestamptz,
  "watch_agent_id" text,
  "watch_idem_key" text,
  "watch_args_hash" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tokens_watch_idem_key" ON "tokens" ("watch_idem_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_next_poll" ON "tokens" ("next_poll_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshots" (
  "id" serial PRIMARY KEY,
  "addr" text NOT NULL,
  "ts" timestamptz NOT NULL,
  "inputs" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_addr_ts" ON "snapshots" ("addr", "ts" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scores" (
  "id" serial PRIMARY KEY,
  "addr" text NOT NULL,
  "symbol" text,
  "ts" timestamptz NOT NULL,
  "score" integer,
  "label" text,
  "confidence" double precision NOT NULL,
  "flags" jsonb NOT NULL,
  "engine_version" text NOT NULL,
  "verdict" jsonb NOT NULL,
  "brief" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scores_addr_ts" ON "scores" ("addr", "ts" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scores_score" ON "scores" ("score");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "funding_links" (
  "id" serial PRIMARY KEY,
  "addr" text NOT NULL,
  "wallet" text NOT NULL,
  "funded_by" text,
  "ts" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funding_links_addr_ts" ON "funding_links" ("addr", "ts" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
  "id" serial PRIMARY KEY,
  "dedupe_key" text NOT NULL,
  "addr" text NOT NULL,
  "kind" text NOT NULL,
  "ts" timestamptz NOT NULL,
  "payload" jsonb NOT NULL,
  "delivered" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alerts_dedupe_key" ON "alerts" ("dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_addr_ts" ON "alerts" ("addr", "ts" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_endpoints" (
  "id" text PRIMARY KEY,
  "url" text NOT NULL,
  "declared_tools" jsonb NOT NULL,
  "contract_targets" jsonb NOT NULL,
  "registered_at" timestamptz NOT NULL,
  "owner_agent_id" text,
  "probe" jsonb,
  "trust" integer,
  "idempotency_key" text NOT NULL,
  "args_hash" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_endpoints_url" ON "mcp_endpoints" ("url");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_endpoints_idem" ON "mcp_endpoints" ("idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
  "id" text PRIMARY KEY,
  "first_seen" timestamptz NOT NULL,
  "last_seen" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_calls" (
  "id" serial PRIMARY KEY,
  "agent_id" text NOT NULL,
  "tool" text NOT NULL,
  "addr" text,
  "ts" timestamptz NOT NULL,
  "cost_units" double precision NOT NULL,
  "duration_ms" integer NOT NULL,
  "ok" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_calls_agent_ts" ON "agent_calls" ("agent_id", "ts");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scopes" (
  "api_key" text PRIMARY KEY,
  "scopes" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL
);
