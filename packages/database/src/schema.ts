import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const servers = pgTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ingestEvents = pgTable("ingest_events", {
  eventId: text("event_id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  kind: text("kind").notNull(),
  observedAt: bigint("observed_at", { mode: "number" }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("ingest_events_server_observed_idx").on(table.serverId, table.observedAt)]);

export const liveSnapshots = pgTable("live_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceEventId: text("source_event_id").notNull().references(() => ingestEvents.eventId),
  serverId: text("server_id").notNull().references(() => servers.id),
  observedAt: bigint("observed_at", { mode: "number" }).notNull(),
  onlineCount: integer("online_count").notNull(),
  players: jsonb("players").$type<Array<{ userId: string; name: string; level: number; ping?: number | null }>>().notNull(),
}, (table) => [
  uniqueIndex("live_snapshots_event_idx").on(table.sourceEventId),
  index("live_snapshots_server_observed_idx").on(table.serverId, table.observedAt),
]);

export const onlinePoints = pgTable("online_points", {
  serverId: text("server_id").notNull().references(() => servers.id),
  observedAt: bigint("observed_at", { mode: "number" }).notNull(),
  onlineCount: integer("online_count").notNull(),
  sourceEventId: text("source_event_id").notNull().references(() => ingestEvents.eventId),
}, (table) => [primaryKey({ columns: [table.serverId, table.observedAt] })]);

export const players = pgTable("players", {
  serverId: text("server_id").notNull().references(() => servers.id),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.serverId, table.userId] })]);

export const playerObservations = pgTable("player_observations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  userId: text("user_id").notNull(),
  observedAt: bigint("observed_at", { mode: "number" }).notNull(),
  level: integer("level").notNull(),
  ping: doublePrecision("ping"),
  exp: bigint("exp", { mode: "number" }),
  sourceEventId: text("source_event_id").notNull().references(() => ingestEvents.eventId),
}, (table) => [
  uniqueIndex("player_observations_identity_idx").on(table.serverId, table.userId, table.observedAt),
  index("player_observations_player_idx").on(table.serverId, table.userId, table.observedAt),
]);

export const playerSessions = pgTable("player_sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  endedAt: bigint("ended_at", { mode: "number" }),
  sourceEventId: text("source_event_id").notNull().references(() => ingestEvents.eventId),
}, (table) => [
  uniqueIndex("player_sessions_identity_idx").on(table.serverId, table.userId, table.startedAt),
  index("player_sessions_player_idx").on(table.serverId, table.userId, table.startedAt),
]);

export const richSnapshots = pgTable("rich_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  userId: text("user_id").notNull(),
  observedAt: bigint("observed_at", { mode: "number" }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  sourceEventId: text("source_event_id").notNull().references(() => ingestEvents.eventId),
}, (table) => [
  uniqueIndex("rich_snapshots_identity_idx").on(table.serverId, table.userId, table.observedAt),
  index("rich_snapshots_player_idx").on(table.serverId, table.userId, table.observedAt),
]);
