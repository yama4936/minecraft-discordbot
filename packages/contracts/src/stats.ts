import { z } from "zod";

export const publicStatsSchema = z.object({
  generatedAt: z.number().int(),
  latest: z.object({
    timestamp: z.number().int(),
    online: z.number().int().nonnegative(),
    players: z.array(z.object({
      id: z.string(),
      name: z.string(),
      level: z.number().int().nonnegative(),
      ping: z.number().nullable(),
    })),
  }).nullable(),
  online: z.array(z.object({
    timestamp: z.number().int(),
    online: z.number().int().nonnegative(),
  })),
  players: z.array(z.object({
    id: z.string(),
    name: z.string(),
    history: z.array(z.object({
      timestamp: z.number().int(),
      level: z.number().int().nonnegative(),
      ping: z.number().nullable(),
    })),
    connectionMinutes: z.number().int().nonnegative(),
    estimatedPlayMinutes: z.number().int().nonnegative(),
    completedConnectionSessions: z.number().int().nonnegative(),
    completedPlaySessions: z.number().int().nonnegative(),
    dailyPlaytime: z.array(z.object({ day: z.string(), minutes: z.number().int().nonnegative() })),
    details: z.array(z.record(z.string(), z.unknown())),
  })),
});

export type PublicStats = z.infer<typeof publicStatsSchema>;
