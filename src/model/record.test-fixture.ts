import { ledgerSchema } from "./audit";
import type { RecordStore } from "./predictionRecord";
import { generatePredictions } from "./predictions";

export function recordFixture() {
  const at = "2026-11-02T22:00:00Z";
  const team = (id: string) => ({
    id,
    name: `Team ${id}`,
    firstHalfPoints: 37,
    pace: 70,
    offensiveEfficiency: 1.05,
    defensiveEfficiency: 1.05,
    currentWeight: 0,
    currentGames: 0,
    priorAvailable: true,
    strengthOfSchedule: null,
    notes: [],
  });
  const ledger = ledgerSchema.parse({
    schemaVersion: 1,
    season: "2026-27",
    seasonStart: "2026-11-01",
    through: "2026-11-02",
    capturedAt: "2026-11-02T21:00:00Z",
    market: "first_half_total",
    unmatchedOdds: [],
    notes: [],
    games: [
      {
        id: "game",
        startsAt: "2026-11-03T00:00:00Z",
        status: "Scheduled",
        firstHalfComplete: false,
        seasonDebut: true,
        capturedAt: "2026-11-02T21:00:00Z",
        away: {
          espnId: "1",
          modelId: "a",
          name: "Team A",
          firstHalfPoints: null,
        },
        home: {
          espnId: "2",
          modelId: "b",
          name: "Team B",
          firstHalfPoints: null,
        },
        scoresSource: "https://example.com/score",
        boxScoreUrl: "https://example.com/box",
        featureSnapshot: {
          kind: "captured_pregame",
          capturedAt: "2026-11-02T20:00:00Z",
          statsRetrievedAt: "2026-11-02T19:00:00Z",
          priorAsOf: "2026-04-07",
          currentAsOf: "2026-11-02",
          modelVersion: "season-bridge-v1",
          away: team("a"),
          home: team("b"),
        },
        quotes: [
          {
            sportsbook: "betmgm",
            opening: { total: 70, overPrice: -110, underPrice: -110 },
            latest: { total: 70, overPrice: -115, underPrice: -105 },
            openingCapturedAt: "2026-11-02T19:00:00Z",
            latestCapturedAt: "2026-11-02T21:00:00Z",
            closingVerified: false,
            quoteTimestamp: null,
            source: "https://example.com/odds",
          },
        ],
      },
    ],
  });
  const store: RecordStore = {
    schemaVersion: 1,
    updatedAt: at,
    records: [],
    results: [],
  };
  return {
    at,
    ledger,
    store,
    feed: generatePredictions(ledger, at, "main", "betmgm"),
  };
}
