import { describe, expect, it } from "vitest";
import {
  captureFeatures,
  evaluateSeason,
  ledgerSchema,
  type SeasonLedger,
} from "./audit";
import { datasetSchema } from "./schema";

function fixture(): SeasonLedger {
  const team = (id: string) => ({
    id,
    name: id,
    firstHalfPoints: 35,
    pace: 70,
    offensiveEfficiency: 1.1,
    defensiveEfficiency: 1,
    currentWeight: 0,
    currentGames: 0,
    priorAvailable: true,
    strengthOfSchedule: null,
    notes: [],
  });
  return {
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
        id: "test",
        startsAt: "2026-11-01T14:30:00Z",
        status: "Final",
        firstHalfComplete: true,
        away: {
          espnId: "1",
          conferenceId: null,
          conference: null,
          rank: null,
          rankKnown: false,
          modelId: "a",
          name: "A",
          firstHalfPoints: 30,
        },
        home: {
          espnId: "2",
          conferenceId: null,
          conference: null,
          rank: null,
          rankKnown: false,
          modelId: "b",
          name: "B",
          firstHalfPoints: 36,
        },
        seasonDebut: true,
        scoresSource: "https://example.com/scores",
        boxScoreUrl: "https://example.com/box",
        capturedAt: "2026-11-02T21:00:00Z",
        quotes: [
          {
            sportsbook: "betmgm",
            opening: { total: 68.5, overPrice: -110, underPrice: -110 },
            latest: { total: 67.5, overPrice: -110, underPrice: -110 },
            openingCapturedAt: "2026-11-02T21:00:00Z",
            latestCapturedAt: "2026-11-02T21:00:00Z",
            closingVerified: false,
            quoteTimestamp: null,
            source: "https://example.com/odds",
          },
        ],
        featureSnapshot: {
          kind: "reconstructed_season_debut",
          capturedAt: "2026-11-02T21:00:00Z",
          priorAsOf: "2026-04-07",
          currentAsOf: null,
          modelVersion: "season-bridge-v1",
          away: team("a"),
          home: team("b"),
        },
      },
    ],
  };
}

describe("first-half market audit", () => {
  it.each(["2026-11-02", "2026-11-03"])(
    "uses the actual freeze time on %s rather than an older source timestamp for pregame provenance",
    (gameDate) => {
      const prior = datasetSchema.parse({
        schemaVersion: 1,
        season: "2025-26",
        asOf: "2026-04-07",
        retrievedAt: "2026-11-01T10:00:00Z",
        source: { name: "Test", urls: {} },
        teams: ["a", "b"].map((id) => ({
          id,
          name: id,
          gamesPlayed: 30,
          firstHalfPoints: 35,
          pace: 70,
          offensiveEfficiency: 1.1,
          defensiveEfficiency: 1,
          strengthOfSchedule: null,
        })),
      });
      const current = datasetSchema.parse({
        ...prior,
        season: "2026-27",
        asOf: gameDate,
        retrievedAt: `${gameDate}T10:00:00Z`,
        teams: prior.teams.map((team) => ({ ...team, gamesPlayed: 1 })),
      });
      const data = fixture();
      data.capturedAt = `${gameDate}T11:00:00Z`;
      data.games[0].startsAt = `${gameDate}T14:30:00Z`;
      data.games[0].seasonDebut = false;
      data.games[0].featureSnapshot = null;
      data.games[0].away.modelId = prior.teams[0].id;
      data.games[0].home.modelId = prior.teams[1].id;
      expect(
        captureFeatures(data, prior, current, `${gameDate}T18:00:00Z`).games[0]
          .featureSnapshot,
      ).toBeNull();
      const before = captureFeatures(
        data,
        prior,
        current,
        `${gameDate}T12:00:00Z`,
      ).games[0].featureSnapshot;
      expect(before).toMatchObject({
        kind: "captured_pregame",
        capturedAt: `${gameDate}T12:00:00Z`,
      });
      expect(before?.currentAsOf).toBe(gameDate);
      current.asOf = "2026-11-04";
      expect(
        captureFeatures(data, prior, current, `${gameDate}T12:00:00Z`).games[0]
          .featureSnapshot,
      ).toBeNull();
    },
  );
  it("benchmarks the fixed book's opener, not its latest or a more favorable line", () => {
    const result = evaluateSeason(ledgerSchema.parse(fixture()));
    expect(result.rows[0]).toMatchObject({
      actual: 66,
      line: 68.5,
      legacyPick: "OVER",
      legacyGrade: "Loss",
    });
    expect(result.marketMae).toBe(2.5);
    expect(result.modelMae).toBeCloseTo(5.4);
    expect(result.prospective).toBe(0);
    expect(result.calibrationStatus).toBe("INSUFFICIENT_SAMPLE");
  });
  it("does not replace missing sportsbook data with another book", () => {
    expect(evaluateSeason(fixture(), "draftkings").sample).toBe(0);
  });
  it("never grades a first half that is still being played", () => {
    const data = fixture();
    data.games[0].firstHalfComplete = false;
    expect(evaluateSeason(data).sample).toBe(0);
  });
  it("can grade a completed first half while the game remains in progress", () => {
    const data = fixture();
    data.games[0].status = "In Progress";
    expect(evaluateSeason(data).sample).toBe(1);
  });
  it("rejects post-tipoff observations falsely marked as pregame captures", () => {
    const data = fixture();
    const features = data.games[0].featureSnapshot;
    if (!features) throw new Error("Missing fixture features");
    features.kind = "captured_pregame";
    features.currentAsOf = "2026-11-01";
    expect(evaluateSeason(data).sample).toBe(0);
  });
  it("does not reconstruct repeat-game inputs from final season stats", () => {
    const data = fixture();
    data.games[0].seasonDebut = false;
    expect(evaluateSeason(data).sample).toBe(0);
  });
  it("rejects a reconstruction that includes a current game observation", () => {
    const data = fixture();
    const features = data.games[0].featureSnapshot;
    if (!features) throw new Error("Missing fixture features");
    features.away.currentGames = 1;
    expect(evaluateSeason(data).sample).toBe(0);
  });
  it("does not represent unverified latest quotes as verified closing lines", () => {
    const data = fixture();
    expect(
      ledgerSchema.safeParse({
        ...data,
        games: [
          {
            ...data.games[0],
            quotes: [{ ...data.games[0].quotes[0], closingVerified: true }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
