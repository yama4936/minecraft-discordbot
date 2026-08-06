import type { IngestEnvelope, LegacyIngestPayload } from "@palworld/contracts";
import { sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  ingestEvents,
  liveSnapshots,
  onlinePoints,
  playerObservations,
  playerSessions,
  players,
  richSnapshots,
  servers,
} from "./schema";

function payloadKind(payload: LegacyIngestPayload) {
  return "type" in payload ? payload.type : "live-snapshot";
}

type PlayerIdentity = { userId: string; name: string };

async function upsertPlayers(db: Database, serverId: string, identities: PlayerIdentity[]) {
  const unique = [...new Map(identities.map((player) => [player.userId, player])).values()];
  if (!unique.length) return;
  await db.insert(players).values(unique.map((player) => ({
    serverId,
    userId: player.userId,
    displayName: player.name,
  }))).onConflictDoUpdate({
    target: [players.serverId, players.userId],
    set: {
      displayName: sql`excluded.display_name`,
      updatedAt: new Date(),
    },
  });
}

export async function ingest(db: Database, envelope: IngestEnvelope) {
  const { eventId, serverId, observedAt, payload } = envelope;
  const kind = payloadKind(payload);

  await db.insert(servers).values({ id: serverId, name: serverId })
    .onConflictDoNothing({ target: servers.id });
  await db.insert(ingestEvents).values({
    eventId,
    serverId,
    kind,
    observedAt,
    payload: payload as unknown as Record<string, unknown>,
  }).onConflictDoNothing({ target: ingestEvents.eventId });

  if (!("type" in payload)) {
    await db.insert(liveSnapshots).values({
      sourceEventId: eventId,
      serverId,
      observedAt: payload.timestamp,
      onlineCount: payload.players.length,
      players: payload.players,
    }).onConflictDoNothing({ target: liveSnapshots.sourceEventId });
    await db.insert(onlinePoints).values({
      sourceEventId: eventId,
      serverId,
      observedAt: payload.timestamp,
      onlineCount: payload.players.length,
    }).onConflictDoUpdate({
      target: [onlinePoints.serverId, onlinePoints.observedAt],
      set: { onlineCount: sql`excluded.online_count`, sourceEventId: eventId },
    });
    await upsertPlayers(db, serverId, payload.players);
    if (payload.players.length) {
      await db.insert(playerObservations).values(payload.players.map((player) => ({
        serverId,
        userId: player.userId,
        observedAt: payload.timestamp,
        level: player.level,
        ping: player.ping ?? null,
        sourceEventId: eventId,
      }))).onConflictDoNothing({
        target: [playerObservations.serverId, playerObservations.userId, playerObservations.observedAt],
      });
    }
    return { imported: payload.players.length, active: payload.players.length };
  }

  if (payload.type === "online-history") {
    if (payload.events.length) {
      await db.insert(onlinePoints).values(payload.events.map((point) => ({
        serverId,
        observedAt: point.timestamp,
        onlineCount: point.online,
        sourceEventId: eventId,
      }))).onConflictDoUpdate({
        target: [onlinePoints.serverId, onlinePoints.observedAt],
        set: {
          onlineCount: sql`excluded.online_count`,
          sourceEventId: eventId,
        },
      });
    }
    return { imported: payload.events.length, active: 0 };
  }

  if (payload.type === "connection-history-v2" || payload.type === "playtime-history") {
    const active = payload.type === "connection-history-v2" ? payload.active : [];
    const allSessions = [...payload.events, ...active];
    await upsertPlayers(db, serverId, allSessions);
    if (allSessions.length) {
      await db.insert(playerSessions).values(allSessions.map((session) => ({
        serverId,
        userId: session.userId,
        displayName: session.name,
        startedAt: session.startedAt,
        endedAt: "endedAt" in session ? session.endedAt : null,
        sourceEventId: eventId,
      }))).onConflictDoUpdate({
        target: [playerSessions.serverId, playerSessions.userId, playerSessions.startedAt],
        set: {
          displayName: sql`excluded.display_name`,
          endedAt: sql`excluded.ended_at`,
          sourceEventId: eventId,
        },
      });
    }
    return { imported: payload.events.length, active: active.length };
  }

  if (payload.type === "join-history") {
    await upsertPlayers(db, serverId, payload.events);
    return { imported: payload.events.length, active: 0 };
  }

  if (payload.type === "level-history" || payload.type === "rich-history") {
    await upsertPlayers(db, serverId, payload.events);
    if (payload.events.length) {
      await db.insert(playerObservations).values(payload.events.map((event) => ({
        serverId,
        userId: event.userId,
        observedAt: event.timestamp,
        level: event.level,
        exp: event.exp ?? null,
        ping: null,
        sourceEventId: eventId,
      }))).onConflictDoUpdate({
        target: [playerObservations.serverId, playerObservations.userId, playerObservations.observedAt],
        set: {
          level: sql`excluded.level`,
          exp: sql`excluded.exp`,
          sourceEventId: eventId,
        },
      });
      if (payload.type === "rich-history") {
        await db.insert(richSnapshots).values(payload.events.map((event) => ({
          serverId,
          userId: event.userId,
          observedAt: event.timestamp,
          detail: event as unknown as Record<string, unknown>,
          sourceEventId: eventId,
        }))).onConflictDoUpdate({
          target: [richSnapshots.serverId, richSnapshots.userId, richSnapshots.observedAt],
          set: {
            detail: sql`excluded.detail`,
            sourceEventId: eventId,
          },
        });
      }
    }
    return { imported: payload.events.length, active: 0 };
  }

  return { imported: 0, active: 0 };
}
