const fs = require("node:fs");
const { createHmac, randomUUID } = require("node:crypto");

function createIngestClient({ legacyUrl, legacySecretFile }) {
  const apiBaseUrl = process.env.PALWORLD_API_URL?.replace(/\/$/, "");
  const url = apiBaseUrl ? `${apiBaseUrl}/v1/ingest` : legacyUrl;
  const serverId = process.env.PALWORLD_SERVER_ID || "main";
  const keyId = process.env.PALWORLD_INGEST_KEY_ID || "";
  const signingSecret = process.env.PALWORLD_INGEST_SECRET || "";

  return async function postPayload(payload) {
    const eventId = randomUUID();
    const observedAt = Number(payload.timestamp) || Date.now();
    const signed = Boolean(apiBaseUrl && keyId && signingSecret);
    const body = JSON.stringify(signed ? {
      schemaVersion: 1,
      eventId,
      serverId,
      observedAt,
      payload,
    } : payload);
    const timestamp = String(Date.now());
    const headers = { "Content-Type": "application/json" };

    if (signed) {
      headers["X-Palworld-Key-Id"] = keyId;
      headers["X-Palworld-Timestamp"] = timestamp;
      headers["X-Palworld-Event-Id"] = eventId;
      headers["X-Palworld-Signature"] = createHmac("sha256", signingSecret)
        .update(`${timestamp}.${eventId}.${body}`)
        .digest("hex");
    } else {
      const legacyToken = fs.readFileSync(legacySecretFile, "utf8").trim();
      headers.Authorization = `Bearer ${legacyToken}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`統計API: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  };
}

module.exports = { createIngestClient };
