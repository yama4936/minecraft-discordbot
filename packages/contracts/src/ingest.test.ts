import { describe, expect, it } from "vitest";
import {
  ingestEnvelopeSchema,
  signIngestRequest,
  verifyIngestSignature,
} from "./ingest";

describe("ingest signing", () => {
  it("accepts an intact signature and rejects modified content", () => {
    const body = JSON.stringify({ schemaVersion: 1 });
    const signature = signIngestRequest("secret", "1700000000000", "event-id", body);
    expect(verifyIngestSignature("secret", "1700000000000", "event-id", body, signature)).toBe(true);
    expect(verifyIngestSignature("secret", "1700000000000", "event-id", `${body} `, signature)).toBe(false);
  });
});

describe("ingest envelope", () => {
  it("accepts the live snapshot shape", () => {
    expect(ingestEnvelopeSchema.parse({
      schemaVersion: 1,
      eventId: "4af5e7b8-eaaf-40a8-b9d7-f00ceeb01f3f",
      serverId: "main",
      observedAt: 1_700_000_000_000,
      payload: { timestamp: 1_700_000_000_000, players: [] },
    }).serverId).toBe("main");
  });
});
