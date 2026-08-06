const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createIngestClient } = require("./ingest-client");

const REPO_DIR = path.resolve(__dirname, "../../..");
const BOT_DIR = process.env.PALWORLD_BOT_DIR || "/mnt/data/minecraft/minecraft-discordbot";
const CONFIG_PATH = process.env.PALWORLD_BOT_CONFIG || path.join(BOT_DIR, "config.json");
const SECRET_PATH = process.env.PALWORLD_INGEST_SECRET_FILE || path.join(BOT_DIR, ".palworld-stats-secret");
const RICH_OUTPUT_PATH = path.join(BOT_DIR, ".palworld-live-rich.json");
const RICH_STATE_PATH = path.join(BOT_DIR, ".palworld-last-rich-backup");
const SAVE_ROOT = process.env.PALWORLD_SAVE_ROOT || "/ssd/SaveGames/0/B7818E3F934D4285B10DFCCA9142A4CB/backup/world";
const INTERVAL_MS = Number(process.env.PALWORLD_COLLECT_INTERVAL_MS) || 5 * 60 * 1000;
const COLLECT_ONCE = process.env.PALWORLD_COLLECT_ONCE === "1";
const postPayload = createIngestClient({
  legacyUrl: "https://new-chat-mu-three.vercel.app/api/ingest",
  legacySecretFile: SECRET_PATH,
});

function getApiConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!config.palworldApi?.baseUrl || !config.palworldApi?.password) {
    throw new Error("Palworld API設定がありません。");
  }
  return config.palworldApi;
}

async function getPlayers() {
  const api = getApiConfig();
  const authorization = Buffer.from(
    `${api.username || "admin"}:${api.password}`,
  ).toString("base64");
  const response = await fetch(`${api.baseUrl}/players`, {
    headers: { Authorization: `Basic ${authorization}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Palworld API: HTTP ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.players) ? body.players : [];
}

function getPlayerIdentities() {
  const logs = execFileSync(
    "docker",
    ["logs", "--since", "2160h", "palworld-server"],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const identities = new Map();
  const pattern = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[LOG\] (.+?) joined the server\. \(User id: ([^,]+),/gm;
  for (const match of logs.matchAll(pattern)) identities.set(match[2], match[3]);
  return identities;
}

function getConnectionHistory(currentPlayers) {
  const logs = execFileSync(
    "docker",
    ["logs", "--since", "2160h", "palworld-server"],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const sessions = [];
  const active = new Map();
  const pattern = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[LOG\] (.+?) (joined|left) the server\. \(User id: ([^,)]+)[^)]*\)/gm;

  for (const match of logs.matchAll(pattern)) {
    const timestamp = new Date(`${match[1].replace(" ", "T")}Z`).getTime();
    if (!Number.isFinite(timestamp)) continue;

    const [, , name, action, userId] = match;
    if (action === "joined") {
      const previous = active.get(userId);
      if (previous && timestamp > previous.startedAt) {
        sessions.push({ ...previous, endedAt: timestamp });
      }
      active.set(userId, { startedAt: timestamp, name, userId });
      continue;
    }

    const started = active.get(userId);
    if (started && timestamp > started.startedAt) {
      sessions.push({ ...started, endedAt: timestamp });
    }
    active.delete(userId);
  }

  const onlineIds = new Set(currentPlayers.map((player) => player.userId));
  return {
    sessions,
    active: [...active.values()].filter((session) => onlineIds.has(session.userId)),
  };
}

function getLatestBackupName() {
  return execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      "-v",
      "palworld_ssd:/ssd:ro",
      "ghcr.io/pocketpairjp/palserver:v1.0.2.100933",
      "-c",
      `find ${SAVE_ROOT} -mindepth 1 -maxdepth 1 -type d | sort | tail -1 | xargs basename`,
    ],
    { encoding: "utf8", timeout: 30_000 },
  ).trim();
}

function analyzeLatestBackup(backupName) {
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-e",
      "PYTHONPATH=/legacy/palworld-stats-python",
      "-v",
      "palworld_ssd:/ssd:ro",
      "-v",
      `${REPO_DIR}:/workspace:ro`,
      "-v",
      `${BOT_DIR}:/legacy`,
      "python:3.12-slim",
      "python3",
      "/workspace/apps/collector/tools/save-analyzer/analyze.py",
      "--extract-rich-snapshot",
      `${SAVE_ROOT}/${backupName}`,
      "/legacy/.palworld-live-rich.json",
    ],
    { encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function sendLiveSnapshot() {
  const players = await getPlayers();
  await postPayload({
    timestamp: Date.now(),
    players: players.map((player) => ({
      userId: player.userId,
      name: player.name,
      level: player.level,
      ping: player.ping,
    })),
  });
  console.log(`${new Date().toISOString()} live players=${players.length}`);
  return players;
}

async function sendConnectionHistory(players) {
  const history = getConnectionHistory(players);
  const result = await postPayload({
    type: "connection-history-v2",
    events: history.sessions,
    active: history.active,
  });
  console.log(
    `${new Date().toISOString()} connections imported=${result.imported || 0} active=${result.active || 0}`,
  );
}

async function sendRichSnapshot() {
  const backupName = getLatestBackupName();
  const previousName = fs.existsSync(RICH_STATE_PATH)
    ? fs.readFileSync(RICH_STATE_PATH, "utf8").trim()
    : "";
  if (!backupName || backupName === previousName) return;

  analyzeLatestBackup(backupName);
  const payload = JSON.parse(fs.readFileSync(RICH_OUTPUT_PATH, "utf8"));
  const identities = getPlayerIdentities();
  payload.events = (payload.events || []).map((event) => ({
    ...event,
    userId: identities.get(event.name) || `backup:${event.userId}`,
  }));
  const result = await postPayload(payload);
  fs.writeFileSync(RICH_STATE_PATH, `${backupName}\n`, "utf8");
  console.log(
    `${new Date().toISOString()} rich backup=${backupName} players=${result.imported || 0}`,
  );
}

let running = false;
async function collect() {
  if (running) return true;
  running = true;
  try {
    const players = await sendLiveSnapshot();
    await sendConnectionHistory(players);
    await sendRichSnapshot();
    return true;
  } catch (error) {
    console.error(`${new Date().toISOString()} ${error.stack || error.message}`);
    return false;
  } finally {
    running = false;
  }
}

async function main() {
  console.log(COLLECT_ONCE
    ? "Palworld統計収集を1回実行します。"
    : "Palworld統計収集を開始しました。5分ごとにオンライン情報と最新バックアップを同期します。");
  const succeeded = await collect();
  if (COLLECT_ONCE) {
    if (!succeeded) process.exitCode = 1;
    return;
  }
  setInterval(collect, INTERVAL_MS);
}

main();
