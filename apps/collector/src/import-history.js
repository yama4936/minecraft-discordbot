const { execFileSync } = require("node:child_process");
const { createIngestClient } = require("./ingest-client");

const postPayload = createIngestClient({
  legacyUrl: "https://new-chat-mu-three.vercel.app/api/ingest",
  legacySecretFile: process.env.PALWORLD_INGEST_SECRET_FILE
    || "/mnt/data/minecraft/minecraft-discordbot/.palworld-stats-secret",
});

const logs = execFileSync(
  "docker",
  ["logs", "--since", "2160h", "palworld-server"],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
);

const events = [];
const sessions = [];
const active = new Map();
const onlineHistory = [];
const pattern = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[LOG\] (.+?) (joined|left) the server\. \(User id: ([^,)]+)[^)]*\)/gm;
for (const match of logs.matchAll(pattern)) {
  const timestamp = new Date(`${match[1].replace(" ", "T")}Z`).getTime();
  if (!Number.isFinite(timestamp)) continue;
  const [, , name, action, userId] = match;
  if (action === "joined") {
    events.push({ timestamp, name, userId });
    active.set(userId, { startedAt: timestamp, name, userId });
    onlineHistory.push({ timestamp, online: active.size });
    continue;
  }
  const start = active.get(userId);
  if (start) sessions.push({ ...start, endedAt: timestamp });
  active.delete(userId);
  onlineHistory.push({ timestamp, online: active.size });
}
if (onlineHistory.length) {
  onlineHistory.unshift({
    timestamp: onlineHistory[0].timestamp - 1,
    online: 0,
  });
}

(async () => {
  for (const payload of [
    { type: "join-history", events },
    { type: "playtime-history", events: sessions },
    { type: "online-history", events: onlineHistory },
  ]) {
    await postPayload(payload);
  }
  console.log(
    `Imported ${events.length} joins, ${sessions.length} completed sessions, `
      + `and ${onlineHistory.length} online-count events.`,
  );
})();
