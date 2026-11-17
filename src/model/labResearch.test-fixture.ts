import type { LabHalf } from "./lab";
import { researchModelSchema } from "./labResearch";
import { recordFixture } from "./record.test-fixture";
import { refereeStoreSchema } from "./referees";

export function researchFixture() {
  const f = recordFixture();
  const at = "2026-11-02T23:50:00Z";
  const game = f.ledger.games[0];
  game.quotes[0].sportsbook = "draftkings";
  game.quotes[0].latestCapturedAt = at;
  if (!game.quotes[0].latest) throw new Error("Missing fixture quote");
  game.quotes[0].latest.total = 70.5;
  f.feed.marketCapturedAt = at;
  const row = f.feed.predictions[0];
  row.markets = row.markets.map((m) => ({
    ...m,
    sportsbook: "draftkings",
    latestLine: 70.5,
    capturedAt: at,
  }));
  f.feed.defaultSportsbook = "draftkings";
  f.feed.generatedAt = at;
  const team = (id: string) => ({
    espnId: id,
    points: 35,
    fouls: 8,
    bonusMinutes: 2,
    fga: 28,
    fta: 8,
    freeThrowsMade: 6,
    threeMade: 3,
    threeAttempted: 10,
    turnovers: 6,
    offensiveRebounds: 4,
  });
  const halves: LabHalf[] = Array.from({ length: 25 }, (_, i) => ({
    id: `half-${i}`,
    gameId: `history-${i}`,
    season: f.ledger.season,
    startsAt: "2026-11-01T15:00:00Z",
    observedAt: "2026-11-01T17:00:00Z",
    source: "https://example.com/half",
    sourceSha256: "a".repeat(64),
    bothD1: true,
    teams: [team(game.away.espnId), team(game.home.espnId)],
  }));
  const model = researchModelSchema.parse({
    schemaVersion: 1,
    method: "market-core-v3+referee-core-v4",
    date: "2026-11-02",
    fittedAt: "2026-11-02T12:00:00Z",
    trainingGames: 100,
    trainingIds: ["training"],
    latestOutcomeAt: "2026-11-01T23:00:00Z",
    sigma: 10,
    scales: [1, 1],
    coefficients: [1, 0],
    sourceHash: "source",
    refereeSourceHash: "refs",
    refereeProfiles: ["a", "b", "c"].map((id) => ({
      id,
      name: `Ref ${id}`,
      games: 10,
      pricedGames: 5,
      pointsAssociation: 1,
      metrics: {},
    })),
    refereeTrainingGames: 30,
    rules: {
      minimumTrainingGames: 80,
      ridge: 20,
      expectedReturn: 0.05,
      refPseudoGames: 20,
      refMinimumGames: 3,
      refMinimumPricedHalves: 20,
      refPointCap: 2,
    },
  });
  const refs = refereeStoreSchema.parse({
    schemaVersion: 1,
    updatedAt: at,
    measurements: [],
    errors: [],
    assignments: [
      {
        id: "crew",
        gameId: game.id,
        season: f.ledger.season,
        startsAt: game.startsAt,
        awayEspnId: game.away.espnId,
        homeEspnId: game.home.espnId,
        observedAt: at,
        source: "https://example.com/crew",
        sourceSha256: "b".repeat(64),
        officials: model.refereeProfiles.map(({ id, name }) => ({ id, name })),
      },
    ],
    checks: [{ gameId: game.id, checkedAt: at, assignmentId: "crew" }],
  });
  return {
    ...f,
    at,
    game,
    row,
    halves,
    model,
    refs,
    modelPath: "data/lab-research-models/test.json",
  };
}
