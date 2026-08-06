import type { IngestEnvelope, LegacyIngestPayload } from "@palworld/contracts";
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

async function upsertPlayer(db: Database, serverId: string, userId: string, displayName: string) {
  await db.insert(players).values({ serverId, userId, displayName })
    .onConflictDoUpdate({
      target: [players.serverId, players.userId],
      set: { displayName, updatedAt: new Date() },
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

  let imported = 0;
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
      set: { onlineCount: payload.players.length, sourceEventId: eventId },
    });
    for (const player of payload.players) {
      await upsertPlayer(db, serverId, player.userId, player.name);
      await db.insert(playerObservations).values({
        serverId,
        userId: player.userId,
        observedAt: payload.timestamp,
        level: player.level,
        ping: player.ping ?? null,
        sourceEventId: eventId,
      }).onConflictDoNothing({
        target: [playerObservations.serverId, playerObservations.userId, playerObservations.observedAt],
      });
      imported += 1;
    }
    return { imported, active: payload.players.length };
  }

  if (payload.type === "online-history") {
    for (const point of payload.events) {
      await db.insert(onlinePoints).values({
        serverId,
        observedAt: point.timestamp,
        onlineCount: point.online,
        sourceEventId: eventId,
      }).onConflictDoUpdate({
        target: [onlinePoints.serverId, onlinePoints.observedAt],
        set: { onlineCount: point.online, sourceEventId: eventId },
      });
      imported += 1;
    }
  }

  if (payload.type === "connection-history-v2" || payload.type === "playtime-history") {
    const completed = payload.events;
    for (const session of completed) {
      await upsertPlayer(db, serverId, session.userId, session.name);
      await db.insert(playerSessions).values({
        serverId,
        userId: session.userId,
        displayName: session.name,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        sourceEventId: eventId,
      }).onConflictDoUpdate({
        target: [playerSessions.serverId, playerSessions.userId, playerSessions.startedAt],
        set: { endedAt: session.endedAt, displayName: session.name, sourceEventId: eventId },
      });
      imported += 1;
    }
    if (payload.type === "connection-history-v2") {
      for (const session of payload.active) {
        await upsertPlayer(db, serverId, session.userId, session.name);
        await db.insert(playerSessions).values({
          serverId,
          userId: session.userId,
          displayName: session.name,
          startedAt: session.startedAt,
          endedAt: null,
          sourceEventId: eventId,
        }).onConflictDoUpdate({
          target: [playerSessions.serverId, playerSessions.userId, playerSessions.startedAt],
          set: { displayName: session.name, sourceEventId: eventId },
        });
      }
      return { imported, active: payload.active.length };
    }
  }

  if (payload.type === "join-history") {
    for (const event of payload.events) {
      await upsertPlayer(db, serverId, event.userId, event.name);
      imported += 1;
    }
  }

  if (payload.type === "level-history" || payload.type === "rich-history") {
    for (const event of payload.events) {
      await upsertPlayer(db, serverId, event.userId, event.name);
      await db.insert(playerObservations).values({
        serverId,
        userId: event.userId,
        observedAt: event.timestamp,
        level: event.level,
        exp: event.exp ?? null,
        ping: null,
        sourceEventId: eventId,
      }).onConflictDoUpdate({
        target: [playerObservations.serverId, playerObservations.userId, playerObservations.observedAt],
        set: { level: event.level, exp: event.exp ?? null, sourceEventId: eventId },
      });
      if (payload.type === "rich-history") {
        await db.insert(richSnapshots).values({
          serverId,
          userId: event.userId,
          observedAt: event.timestamp,
          detail: event as unknown as Record<string, unknown>,
          sourceEventId: eventId,
        }).onConflictDoUpdate({
          target: [richSnapshots.serverId, richSnapshots.userId, richSnapshots.observedAt],
          set: { detail: event as unknown as Record<string, unknown>, sourceEventId: eventId },
        });
      }
      imported += 1;
    }
  }

  return { imported, active: 0 };
}
