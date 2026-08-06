const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { createIngestClient } = require("./ingest-client");

const postPayload = createIngestClient({
  legacyUrl: "https://new-chat-mu-three.vercel.app/api/ingest",
  legacySecretFile: process.env.PALWORLD_INGEST_SECRET_FILE
    || "/mnt/data/minecraft/minecraft-discordbot/.palworld-stats-secret",
});
const historyPath = process.argv[2];

if (!historyPath) throw new Error("Usage: node import-palworld-level-history.js <level-history.json>");

const payload = JSON.parse(fs.readFileSync(historyPath, "utf8"));
const logs = execFileSync(
  "docker",
  ["logs", "--since", "2160h", "palworld-server"],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
);

const identities = new Map();
const pattern = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[LOG\] (.+?) joined the server\. \(User id: ([^,]+),/gm;
for (const match of logs.matchAll(pattern)) identities.set(match[2], match[3]);

const unmatched = new Set();
const events = payload.events.map((event) => {
  const userId = identities.get(event.name);
  if (!userId) unmatched.add(event.name);
  return {
    ...event,
    userId: userId || `backup:${event.userId}`,
  };
});

(async () => {
  const result = await postPayload({ type: payload.type || "level-history", events });
  console.log(JSON.stringify({
    ...result,
    identities: identities.size,
    unmatched: [...unmatched],
  }, null, 2));
})();
