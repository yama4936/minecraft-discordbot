import "server-only";
import { randomUUID } from "node:crypto";
import {
  ingestEnvelopeSchema,
  legacyIngestPayloadSchema,
  publicStatsSchema,
  verifyIngestSignature,
} from "@palworld/contracts";
import { createDatabase, getPublicStats, ingest } from "@palworld/database";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_SERVER_ID = process.env.PALWORLD_SERVER_ID || "main";

function signingKeys() {
  const entries = (process.env.INGEST_SIGNING_KEYS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf(":");
        return separator > 0
          ? [entry.slice(0, separator), entry.slice(separator + 1)] as const
          : null;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0] && entry[1]));
  return new Map(entries);
}

function authorizedByLegacyToken(authorization: string | undefined) {
  const legacyToken = process.env.LEGACY_INGEST_TOKEN;
  return Boolean(legacyToken && authorization === `Bearer ${legacyToken}`);
}

function authorizedBySignature(headers: Headers, body: string) {
  const keyId = headers.get("x-palworld-key-id") || "";
  const timestamp = headers.get("x-palworld-timestamp") || "";
  const eventId = headers.get("x-palworld-event-id") || "";
  const signature = headers.get("x-palworld-signature") || "";
  const secret = signingKeys().get(keyId);
  const timestampNumber = Number(timestamp);
  if (!secret || !eventId || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Date.now() - timestampNumber) > MAX_CLOCK_SKEW_MS) return false;
  return verifyIngestSignature(secret, timestamp, eventId, body, signature);
}

const app = new Hono().basePath("/api");

app.use("*", secureHeaders());
app.use("/ingest", bodyLimit({ maxSize: 1024 * 1024 }));
app.use("/v1/ingest", bodyLimit({ maxSize: 1024 * 1024 }));

app.get("/health", (c) => c.json({ ok: true, service: "palworld-api" }));

async function handleStats(serverId = DEFAULT_SERVER_ID) {
  if (process.env.LEGACY_STATS_API_URL) {
    const response = await fetch(process.env.LEGACY_STATS_API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Legacy stats API returned HTTP ${response.status}`);
    return publicStatsSchema.parse(await response.json());
  }
  const data = await getPublicStats(createDatabase(), serverId);
  return data;
}

app.get("/stats", async (c) => c.json(await handleStats()));
app.get("/v1/servers/:serverId/stats", async (c) => c.json(await handleStats(c.req.param("serverId"))));

async function handleIngest(c: Context) {
  const body = await c.req.text();
  const authorization = c.req.header("authorization");
  if (!authorizedByLegacyToken(authorization) && !authorizedBySignature(c.req.raw.headers, body)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const envelopeResult = ingestEnvelopeSchema.safeParse(parsedJson);
  const envelope = envelopeResult.success
    ? envelopeResult.data
    : (() => {
      const legacy = legacyIngestPayloadSchema.safeParse(parsedJson);
      if (!legacy.success) return null;
      const observedAt = "timestamp" in legacy.data ? legacy.data.timestamp : Date.now();
      return {
        schemaVersion: 1 as const,
        eventId: c.req.header("x-palworld-event-id") || randomUUID(),
        serverId: DEFAULT_SERVER_ID,
        observedAt,
        payload: legacy.data,
      };
    })();
  if (!envelope) return c.json({ error: "invalid_payload" }, 422);
  const signedEventId = c.req.header("x-palworld-event-id");
  if (signedEventId && signedEventId !== envelope.eventId) {
    return c.json({ error: "event_id_mismatch" }, 400);
  }

  const result = await ingest(createDatabase(), envelope);
  return c.json({ ok: true, eventId: envelope.eventId, ...result });
}

app.post("/ingest", handleIngest);
app.post("/v1/ingest", handleIngest);

app.onError((error, c) => {
  console.error(JSON.stringify({ level: "error", message: error.message, path: c.req.path }));
  return c.json({ error: "internal_server_error" }, 500);
});

export default app;
export type Api = typeof app;
