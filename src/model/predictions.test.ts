import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ledgerSchema } from "./audit";
import {
  dailyPredictions,
  filterPredictionGroups,
  generatePredictions,
  isTop25,
  type PredictionRow,
  predictionComparison,
  predictionsToCsv,
  topEdgePredictions,
  updateDailyArchive,
  workbookPayload,
} from "./predictions";
import { predict } from "./predictor";
import { recordFixture } from "./record.test-fixture";

const ledger = ledgerSchema.parse(
  JSON.parse(readFileSync("public/data/season-games.json", "utf8")),
);
const generatedAt = "2026-11-02T23:00:00Z";

describe("all-matchup projection feed", () => {
  it("takes the ten largest absolute edges, excluding missing inputs, unavailable lines and pushes", () => {
    const base = recordFixture().feed.predictions[0];
    const rows: PredictionRow[] = Array.from({ length: 12 }, (_, index) => ({
      ...base,
      gameId: `edge-${index + 1}`,
      projectedFirstHalfTotal: 70 + (index % 2 ? -1 : 1) * (index + 1),
    }));
    rows.push(
      { ...base, gameId: "missing-inputs", projectedFirstHalfTotal: null },
      { ...base, gameId: "missing-line", markets: [] },
      { ...base, gameId: "push", projectedFirstHalfTotal: 70 },
      {
        ...base,
        gameId: "withdrawn-line",
        projectedFirstHalfTotal: 100,
        marketCoverage: {
          checkedAt: generatedAt,
          source: "https://example.com/odds",
          status: "matched",
          books: [{ sportsbook: "betmgm", status: "no_current_line" }],
        },
      },
    );
    const originalOrder = rows.map((row) => row.gameId);
    expect(topEdgePredictions(rows, "betmgm").map((row) => row.gameId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `edge-${12 - index}`),
    );
    expect(rows.map((row) => row.gameId)).toEqual(originalOrder);
  });

  it("re-ranks for each sportsbook and breaks equal edges by tipoff and game ID", () => {
    const base = recordFixture().feed.predictions[0];
    const rows = [
      {
        ...base,
        gameId: "over",
        projectedFirstHalfTotal: 75,
        markets: [
          ...base.markets,
          { ...base.markets[0], sportsbook: "draftkings", latestLine: 74 },
        ],
      },
      {
        ...base,
        gameId: "under",
        projectedFirstHalfTotal: 68,
        markets: [
          ...base.markets,
          { ...base.markets[0], sportsbook: "draftkings", latestLine: 60 },
        ],
      },
    ];
    expect(topEdgePredictions(rows, "betmgm")[0].gameId).toBe("over");
    expect(topEdgePredictions(rows, "draftkings")[0].gameId).toBe("under");
    expect(
      topEdgePredictions(
        [
          { ...rows[0], gameId: "late", startsAt: "2026-11-03T01:00:00Z" },
          { ...rows[0], gameId: "b" },
          { ...rows[0], gameId: "a" },
        ],
        "betmgm",
      ).map((row) => row.gameId),
    ).toEqual(["a", "b", "late"]);
  });

  it.each([
    ["2026-11-03T00:00:00Z", "2026-11-02,7:00 PM,EST"],
    ["2026-07-03T00:00:00Z", "2026-07-02,8:00 PM,EDT"],
  ])(
    "exports human-readable Eastern tipoffs for %s while retaining UTC",
    (startsAt, eastern) => {
      const row = {
        ...generatePredictions(ledger, generatedAt).predictions[0],
        startsAt,
      };
      const csv = predictionsToCsv([row]);
      expect(csv).toContain(
        "tipoff_utc,tipoff_date_et,tipoff_time_et,tipoff_zone",
      );
      expect(csv).toContain(`${startsAt},${eastern}`);
    },
  );
  it("groups either team's conference and combines Top 25 without duplicate games", () => {
    const base = generatePredictions(ledger, generatedAt).predictions[0];
    const rows = [
      {
        ...base,
        gameId: "cross",
        awayConference: "ACC",
        homeConference: "SEC",
        awayRank: 25,
        homeRank: null,
      },
      {
        ...base,
        gameId: "same",
        awayConference: "SEC",
        homeConference: "SEC",
        awayRank: null,
        homeRank: null,
      },
      {
        ...base,
        gameId: "unknown",
        awayConference: null,
        homeConference: null,
        awayRank: null,
        homeRank: null,
      },
    ];
    expect(
      filterPredictionGroups(rows, "SEC").map((row) => row.gameId),
    ).toEqual(["cross", "same"]);
    expect(
      filterPredictionGroups(rows, "SEC", true).map((row) => row.gameId),
    ).toEqual(["cross"]);
    expect(filterPredictionGroups(rows, "all", true)).toHaveLength(1);
    expect(isTop25(rows[2])).toBe(false);
    const feed = {
      ...generatePredictions(ledger, generatedAt),
      predictions: rows,
    };
    const workbook = workbookPayload(feed);
    expect(workbook.predictions[0].comparison).toEqual(
      predictionComparison(
        rows[0],
        feed.defaultSportsbook,
        feed.defaultLineBasis,
      ),
    );
    expect(workbook.predictions.map((row) => row.top25)).toEqual([
      true,
      false,
      false,
    ]);
    const csv = predictionsToCsv(rows);
    expect(csv).toContain(
      "away_conference,home_conference,away_rank,home_rank,top_25_game",
    );
    expect(csv).toContain("ACC,SEC,25,,Yes");
  });
  it("archives the New York game date rather than the UTC date", () => {
    const feed = generatePredictions(
      { ...ledger, through: "2026-11-02" },
      generatedAt,
    );
    const row = feed.predictions[0];
    feed.predictions = [
      { ...row, gameId: "prior-day", startsAt: "2026-11-02T04:59:00Z" },
      { ...row, gameId: "today", startsAt: "2026-11-03T04:30:00Z" },
      { ...row, gameId: "tomorrow", startsAt: "2026-11-03T05:00:00Z" },
    ];
    const daily = dailyPredictions(feed);
    expect(daily?.predictions.map((game) => game.gameId)).toEqual(["today"]);
    expect(daily?.gameDate).toBe("2026-11-02");
    expect(daily?.counts.matchups).toBe(1);
  });
  it("does not relabel stale market data as today's daily download", () => {
    const feed = generatePredictions(
      { ...ledger, through: "2026-11-01" },
      generatedAt,
    );
    expect(dailyPredictions(feed)).toBeNull();
  });
  it("keeps older days and updates the current day without duplicate archive entries", () => {
    const feed = generatePredictions(
      { ...ledger, through: "2026-11-02" },
      generatedAt,
    );
    const daily = dailyPredictions(feed);
    if (!daily) throw new Error("Expected a fresh daily snapshot");
    const old = {
      ...daily,
      gameDate: "2026-11-01",
      generatedAt: "2026-11-01T23:00:00Z",
    };
    let index = updateDailyArchive({ schemaVersion: 1, archives: [] }, old);
    index = updateDailyArchive(index, daily);
    index = updateDailyArchive(index, {
      ...daily,
      generatedAt: "2026-11-02T23:10:00Z",
    });
    expect(index.archives.map((entry) => entry.date)).toEqual([
      "2026-11-02",
      "2026-11-01",
    ]);
    expect(index.archives[0].generatedAt).toBe("2026-11-02T23:10:00Z");
    expect(index.archives[1].generatedAt).toBe("2026-11-01T23:00:00Z");
  });
  it("returns exactly one row for every game, including unavailable projections", () => {
    const feed = generatePredictions(ledger, generatedAt);
    expect(feed.predictions.map((row) => row.gameId)).toEqual(
      ledger.games.map((game) => game.id),
    );
    expect(feed.counts.predicted + feed.counts.unavailable).toBe(
      feed.counts.matchups,
    );
    expect(
      feed.predictions.every(
        (row) =>
          row.projectedFirstHalfTotal !== null ||
          row.unavailableReason !== null,
      ),
    ).toBe(true);
  });
  it("uses the same total as the single-matchup model", () => {
    const game = ledger.games.find(
      (row) => row.featureSnapshot && row.away.modelId && row.home.modelId,
    );
    if (!game?.featureSnapshot)
      throw new Error("No source-backed game fixture");
    const feed = generatePredictions(ledger, generatedAt);
    const total = predict(
      game.featureSnapshot.away,
      game.featureSnapshot.home,
      70,
      "regular",
      0,
    ).projectedTotal;
    expect(
      feed.predictions.find((row) => row.gameId === game.id)
        ?.projectedFirstHalfTotal,
    ).toBe(total);
  });
  it("calculates a model total even when no sportsbook line exists", () => {
    const data = structuredClone(ledger);
    const game = data.games.find(
      (row) => row.featureSnapshot && row.away.modelId && row.home.modelId,
    );
    if (!game) throw new Error("No source-backed game fixture");
    game.quotes = [];
    const row = generatePredictions(data, generatedAt).predictions.find(
      (row) => row.gameId === game.id,
    );
    if (!row) throw new Error("Game was lost");
    expect(row.projectedFirstHalfTotal).not.toBeNull();
    expect(predictionComparison(row, "betmgm", "latest")).toMatchObject({
      line: null,
      lean: null,
    });
  });
  it("does not silently substitute the opener when a latest quote is missing", () => {
    const row = generatePredictions(ledger, generatedAt).predictions.find(
      (row) => row.markets.length && row.projectedFirstHalfTotal !== null,
    );
    if (!row) throw new Error("No priced game fixture");
    row.markets = [
      {
        sportsbook: "test",
        openingLine: 70,
        latestLine: null,
        source: "https://example.com",
        capturedAt: generatedAt,
        closingVerified: false,
      },
    ];
    expect(predictionComparison(row, "test", "latest").line).toBeNull();
    expect(predictionComparison(row, "test", "opening").line).toBe(70);
  });
  it("leaves a projection unavailable when features would leak post-tipoff data", () => {
    const data = structuredClone(ledger);
    const game = data.games.find((row) => row.featureSnapshot);
    if (!game?.featureSnapshot) throw new Error("No feature fixture");
    game.featureSnapshot.kind = "captured_pregame";
    game.featureSnapshot.capturedAt = generatedAt;
    game.startsAt = "2026-11-02T12:00:00Z";
    expect(
      generatePredictions(data, generatedAt).predictions.find(
        (row) => row.gameId === game.id,
      )?.projectedFirstHalfTotal,
    ).toBeNull();
  });
  it("exports all records and escapes commas, quotes and spreadsheet formulas", () => {
    const feed = generatePredictions(ledger, generatedAt);
    const csv = predictionsToCsv(feed.predictions);
    expect(csv.trim().split("\r\n")).toHaveLength(feed.counts.matchups + 1);
    const row = {
      ...feed.predictions[0],
      awayTeam: "=SUM(1,2)",
      homeTeam: 'Team "One"',
    };
    const escaped = predictionsToCsv([row]);
    expect(escaped).toContain('"\'=SUM(1,2)"');
    expect(escaped).toContain('"Team ""One"""');
  });
});
