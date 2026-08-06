CREATE TABLE "ingest_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"kind" text NOT NULL,
	"observed_at" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_event_id" text NOT NULL,
	"server_id" text NOT NULL,
	"observed_at" bigint NOT NULL,
	"online_count" integer NOT NULL,
	"players" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_points" (
	"server_id" text NOT NULL,
	"observed_at" bigint NOT NULL,
	"online_count" integer NOT NULL,
	"source_event_id" text NOT NULL,
	CONSTRAINT "online_points_server_id_observed_at_pk" PRIMARY KEY("server_id","observed_at")
);
--> statement-breakpoint
CREATE TABLE "player_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"observed_at" bigint NOT NULL,
	"level" integer NOT NULL,
	"ping" integer,
	"exp" bigint,
	"source_event_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"started_at" bigint NOT NULL,
	"ended_at" bigint,
	"source_event_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rich_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"observed_at" bigint NOT NULL,
	"detail" jsonb NOT NULL,
	"source_event_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_snapshots" ADD CONSTRAINT "live_snapshots_source_event_id_ingest_events_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."ingest_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_snapshots" ADD CONSTRAINT "live_snapshots_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_points" ADD CONSTRAINT "online_points_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_points" ADD CONSTRAINT "online_points_source_event_id_ingest_events_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."ingest_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_observations" ADD CONSTRAINT "player_observations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_observations" ADD CONSTRAINT "player_observations_source_event_id_ingest_events_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."ingest_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_sessions" ADD CONSTRAINT "player_sessions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_sessions" ADD CONSTRAINT "player_sessions_source_event_id_ingest_events_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."ingest_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rich_snapshots" ADD CONSTRAINT "rich_snapshots_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rich_snapshots" ADD CONSTRAINT "rich_snapshots_source_event_id_ingest_events_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."ingest_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_events_server_observed_idx" ON "ingest_events" USING btree ("server_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_snapshots_event_idx" ON "live_snapshots" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "live_snapshots_server_observed_idx" ON "live_snapshots" USING btree ("server_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "player_observations_identity_idx" ON "player_observations" USING btree ("server_id","user_id","observed_at");--> statement-breakpoint
CREATE INDEX "player_observations_player_idx" ON "player_observations" USING btree ("server_id","user_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "player_sessions_identity_idx" ON "player_sessions" USING btree ("server_id","user_id","started_at");--> statement-breakpoint
CREATE INDEX "player_sessions_player_idx" ON "player_sessions" USING btree ("server_id","user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rich_snapshots_identity_idx" ON "rich_snapshots" USING btree ("server_id","user_id","observed_at");--> statement-breakpoint
CREATE INDEX "rich_snapshots_player_idx" ON "rich_snapshots" USING btree ("server_id","user_id","observed_at");