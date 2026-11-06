import { contextFixture, contextModelPath } from "./gameContext.test-fixture";
import {
  type LabHalf,
  type LabStore,
  labConfigSchema,
  labHalfSchema,
  labMethods,
} from "./lab";
import type { LabInputs } from "./labCapture";
import { recordFixture } from "./record.test-fixture";
import { datasetSchema } from "./schema";

export function labFixture() {
  const base = recordFixture();
  base.feed.marketCapturedAt = base.at;
  base.feed.predictions[0].markets[0].capturedAt = base.at;
  base.ledger.games[0].quotes[0].latestCapturedAt = base.at;
  const prior = datasetSchema.parse({
    schemaVersion: 1,
    season: "2025-26",
    asOf: "2026-04-07",
    retrievedAt: "2026-11-01T10:00:00Z",
    source: { name: "Test", urls: {} },
    teams: ["a", "b"].map((id, i) => ({
      id,
      name: id,
      gamesPlayed: 30,
      firstHalfPoints: 37,
      firstHalfAllowed: 30 + i * 10,
      pace: 70,
      offensiveEfficiency: 1.05,
      defensiveEfficiency: 1.05,
      strengthOfSchedule: null,
    })),
  });
  const team = (id: string, fouls: number) => ({
    espnId: id,
    points: 35,
    fouls,
    bonusMinutes: 5,
    fga: 28,
    fta: 9,
    threeMade: 3,
    threeAttempted: 10,
    turnovers: 6,
    offensiveRebounds: 4,
  });
  const halves: LabHalf[] = [1, 2].map((n) =>
    labHalfSchema.parse({
      id: `history-${n}`,
      gameId: `history-game-${n}`,
      season: "2026-27",
      startsAt: "2026-11-01T20:00:00Z",
      observedAt: "2026-11-01T22:00:00Z",
      source: "https://example.com/pbp",
      sourceSha256: "a".repeat(64),
      bothD1: true,
      teams: [team(String(n), 8 + n), team(`opponent-${n}`, 9)],
    }),
  );
  const inputs: LabInputs = {
    prior,
    priorPath: "data/input-snapshots/prior.json",
    snapshots: [],
    halves,
  };
  const config = labConfigSchema.parse({
    schemaVersion: 1,
    methods: labMethods.map((method) => ({
      id: method.id,
      enabled: !method.id.startsWith("enhanced-baseline-"),
    })),
  });
  const empty: LabStore = {
    schemaVersion: 1,
    startedAt: base.at,
    updatedAt: base.at,
    forecasts: [],
    results: [],
    halves: [],
  };
  return { ...base, inputs, config, empty };
}

export function enhancedLabFixture() {
  const f = labFixture();
  f.config.methods = f.config.methods.map((method) => ({
    ...method,
    enabled: method.id === "enhanced-baseline-v1",
  }));
  f.inputs.halves = Array.from({ length: 40 }, (_, i) => ({
    ...f.inputs.halves[0],
    id: `fit-${i}`,
    gameId: `fit-${i}`,
    teams: f.inputs.halves[0].teams.map((team, side) => ({
      ...team,
      espnId: String(side + 1),
      bonusMinutes: 1 + (i % 10),
      fga: 24 + (i % 4),
      fouls: 7 + (i % 5),
      fta: 12,
      freeThrowsMade: 3 + Math.floor((i % 10) / 2),
    })),
  }));
  return f;
}

export function currentLabFixture() {
  const f = enhancedLabFixture();
  const context = contextFixture();
  f.ledger.games[0].context = context.game.context;
  f.ledger.games[0].contextRetrievedAt = f.at;
  f.config.methods = f.config.methods.map((method) => ({
    ...method,
    enabled: method.id === "enhanced-baseline-v2",
  }));
  f.inputs.contextModel = context.model;
  f.inputs.contextModelPath = contextModelPath;
  return f;
}
