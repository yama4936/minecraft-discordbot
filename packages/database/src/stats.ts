import { and, asc, desc, eq, gte } from "drizzle-orm";
import type { PublicStats } from "@palworld/contracts";
import type { Database } from "./client";
import {
  liveSnapshots,
  onlinePoints,
  playerObservations,
  playerSessions,
  players,
  richSnapshots,
} from "./schema";

function dayKey(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export async function getPublicStats(db: Database, serverId: string): Promise<PublicStats> {
  const [latest] = await db.select().from(liveSnapshots)
    .where(eq(liveSnapshots.serverId, serverId))
    .orderBy(desc(liveSnapshots.observedAt)).limit(1);
  const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const [online, playerRows, observations, sessions, details] = await Promise.all([
    db.select().from(onlinePoints)
      .where(and(eq(onlinePoints.serverId, serverId), gte(onlinePoints.observedAt, since)))
      .orderBy(asc(onlinePoints.observedAt)),
    db.select().from(players).where(eq(players.serverId, serverId)),
    db.select().from(playerObservations)
      .where(eq(playerObservations.serverId, serverId))
      .orderBy(asc(playerObservations.observedAt)),
    db.select().from(playerSessions)
      .where(eq(playerSessions.serverId, serverId))
      .orderBy(asc(playerSessions.startedAt)),
    db.select().from(richSnapshots)
      .where(eq(richSnapshots.serverId, serverId))
      .orderBy(asc(richSnapshots.observedAt)),
  ]);

  return {
    generatedAt: Date.now(),
    latest: latest ? {
      timestamp: latest.observedAt,
      online: latest.onlineCount,
      players: latest.players.map((player) => ({
        id: player.userId,
        name: player.name,
        level: player.level,
        ping: player.ping ?? null,
      })),
    } : null,
    online: online.map((point) => ({ timestamp: point.observedAt, online: point.onlineCount })),
    players: playerRows.map((player) => {
      const history = observations.filter((row) => row.userId === player.userId);
      const playerSessionRows = sessions.filter((row) => row.userId === player.userId);
      const completed = playerSessionRows.filter((row) => row.endedAt !== null);
      const connectionMinutes = completed.reduce(
        (sum, row) => sum + Math.max(0, Math.round(((row.endedAt ?? row.startedAt) - row.startedAt) / 60_000)),
        0,
      );
      const daily = new Map<string, number>();
      for (const row of completed) {
        const minutes = Math.max(0, Math.round(((row.endedAt ?? row.startedAt) - row.startedAt) / 60_000));
        daily.set(dayKey(row.startedAt), (daily.get(dayKey(row.startedAt)) ?? 0) + minutes);
      }
      return {
        id: player.userId,
        name: player.displayName,
        history: history.map((row) => ({
          timestamp: row.observedAt,
          level: row.level,
          ping: row.ping,
        })),
        connectionMinutes,
        estimatedPlayMinutes: connectionMinutes,
        completedConnectionSessions: completed.length,
        completedPlaySessions: completed.length,
        dailyPlaytime: [...daily].map(([day, minutes]) => ({ day, minutes })),
        details: details.filter((row) => row.userId === player.userId).map((row) => row.detail),
      };
    }),
  };
}
