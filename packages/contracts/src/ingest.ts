import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const timestampMs = z.number().int().nonnegative();

export const livePlayerSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  level: z.number().int().nonnegative(),
  ping: z.number().nonnegative().nullable().optional(),
});

export const livePayloadSchema = z.object({
  timestamp: timestampMs,
  players: z.array(livePlayerSchema),
});

export const connectionSessionSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  startedAt: timestampMs,
  endedAt: timestampMs.optional(),
});

export const connectionHistoryPayloadSchema = z.object({
  type: z.literal("connection-history-v2"),
  events: z.array(connectionSessionSchema.extend({ endedAt: timestampMs })),
  active: z.array(connectionSessionSchema),
});

export const onlineHistoryPayloadSchema = z.object({
  type: z.literal("online-history"),
  events: z.array(z.object({ timestamp: timestampMs, online: z.number().int().nonnegative() })),
});

export const joinHistoryPayloadSchema = z.object({
  type: z.literal("join-history"),
  events: z.array(z.object({
    timestamp: timestampMs,
    userId: z.string().min(1),
    name: z.string().min(1),
  })),
});

export const playtimeHistoryPayloadSchema = z.object({
  type: z.literal("playtime-history"),
  events: z.array(connectionSessionSchema.extend({ endedAt: timestampMs })),
});

export const levelEventSchema = z.object({
  timestamp: timestampMs,
  userId: z.string().min(1),
  name: z.string().min(1),
  level: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative().optional(),
  source: z.string().optional(),
}).passthrough();

export const levelHistoryPayloadSchema = z.object({
  type: z.literal("level-history"),
  source: z.string().optional(),
  events: z.array(levelEventSchema),
});

export const richHistoryPayloadSchema = z.object({
  type: z.literal("rich-history"),
  source: z.string().optional(),
  events: z.array(levelEventSchema),
});

export const legacyIngestPayloadSchema = z.union([
  connectionHistoryPayloadSchema,
  onlineHistoryPayloadSchema,
  joinHistoryPayloadSchema,
  playtimeHistoryPayloadSchema,
  levelHistoryPayloadSchema,
  richHistoryPayloadSchema,
  livePayloadSchema,
]);

export type LegacyIngestPayload = z.infer<typeof legacyIngestPayloadSchema>;

export const ingestEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  serverId: z.string().min(1).max(64),
  observedAt: timestampMs,
  payload: legacyIngestPayloadSchema,
});

export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;

export function canonicalIngestMessage(timestamp: string, eventId: string, body: string) {
  return `${timestamp}.${eventId}.${body}`;
}

export function signIngestRequest(secret: string, timestamp: string, eventId: string, body: string) {
  return createHmac("sha256", secret)
    .update(canonicalIngestMessage(timestamp, eventId, body))
    .digest("hex");
}

export function verifyIngestSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
  signature: string,
) {
  const expected = Buffer.from(signIngestRequest(secret, timestamp, eventId, body), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
