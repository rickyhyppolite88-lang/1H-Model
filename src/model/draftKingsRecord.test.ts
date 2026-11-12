import { expect, it } from "vitest";
import { draftKingsRecord, draftKingsRecordIndex } from "./draftKingsRecord";
import { updatePredictionRecord } from "./predictionRecord";
import { recordFixture } from "./record.test-fixture";
import { actualUnitPlay, type UnitLedger } from "./units";

function fixture() {
  const f = recordFixture();
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  const original = store.records[0];
  const quote = {
    ...original.quotes[0],
    sportsbook: "draftkings",
    latest: { total: 75, overPrice: -110, underPrice: -105 },
    latestCapturedAt: original.recordedAt,
  };
  original.quotes.push(quote);
  original.prediction.markets.push({
    ...original.prediction.markets[0],
    sportsbook: "draftkings",
    openingLine: 75,
    latestLine: 75,
    capturedAt: original.recordedAt,
    source: quote.source,
  });
  store.results = [
    {
      id: "result",
      season: original.season,
      gameId: original.gameId,
      observedAt: "2026-11-03T01:00:00Z",
      sourceCapturedAt: "2026-11-03T01:00:00Z",
      awayPoints: 37,
      homePoints: 37,
      source: "https://example.com/results",
    },
  ];
  return { store, original };
}
const at = "2026-11-04T12:00:00Z";
const ledger: UnitLedger = {
  schemaVersion: 1,
  startedAt: at,
  updatedAt: at,
  assignments: [],
};

it("publishes validated DraftKings-only dated archive paths", () => {
  const { store } = fixture();
  const index = draftKingsRecordIndex(draftKingsRecord(store, at));
  expect(index.archives[0].jsonPath).toBe(
    "data/prediction-record-draftkings/2026-11-02.json",
  );
  expect(index.canonicalIds).toHaveLength(1);
});

it("replays the original frozen projection against DraftKings with its own side, score, odds and result without changing saved history or assigning stakes", () => {
  const { store, original } = fixture(),
    before = structuredClone(store);
  const output = draftKingsRecord(store, at);
  expect(store).toEqual(before);
  expect(output.records).toHaveLength(1);
  const replay = output.records[0];
  expect(replay.prediction.projectedFirstHalfTotal).toBe(
    original.prediction.projectedFirstHalfTotal,
  );
  expect(replay.comparison).toMatchObject({ line: 75, lean: "UNDER" });
  expect(replay.replay?.sourceRecordId).toBe(original.id);
  expect(actualUnitPlay(replay, output.results, ledger)).toMatchObject({
    sportsbook: "draftkings",
    side: "UNDER",
    price: -105,
    grade: "Win",
    mode: "historical",
    assignedAt: null,
    scoreSource: "derived_saved_inputs",
    entryPolicy: "draftkings-replay-v1",
  });
  expect(ledger.assignments).toHaveLength(0);
});

it("uses the last valid archived pre-tip quote and ignores later known post-tip prices or observations", () => {
  const { store, original } = fixture();
  const pre = structuredClone(original);
  pre.id = "last-pre";
  pre.recordedAt = "2026-11-02T23:58:00Z";
  pre.version = 2;
  pre.prediction.projectedFirstHalfTotal = 90;
  pre.quotes[1].latest = { total: 70, overPrice: -115, underPrice: -105 };
  pre.quotes[1].latestCapturedAt = pre.recordedAt;
  pre.prediction.markets[1].latestLine = 70;
  const post = structuredClone(pre);
  post.id = "post";
  post.recordedAt = "2026-11-03T00:10:00Z";
  post.version = 3;
  post.quotes[1].latest = { total: 50, overPrice: -110, underPrice: -110 };
  post.prediction.markets[1].latestLine = 50;
  store.records.push(pre, post);
  const replay = draftKingsRecord(store, at).records[0];
  expect(replay.comparison.line).toBe(70);
  expect(replay.replay?.sourceQuoteRecordId).toBe(pre.id);
  expect(replay.prediction.projectedFirstHalfTotal).toBe(
    original.prediction.projectedFirstHalfTotal,
  );
});

it("never substitutes BetMGM when a verified pre-tip DraftKings quote is unavailable", () => {
  const { store, original } = fixture();
  original.quotes = original.quotes.filter(
    (row) => row.sportsbook !== "draftkings",
  );
  expect(draftKingsRecord(store, at).records).toHaveLength(0);
});

it("grades a DraftKings push at zero net units with the archived side's own odds", () => {
  const { store } = fixture();
  store.results[0].awayPoints = 38;
  store.results[0].homePoints = 37;
  const replay = draftKingsRecord(store, at).records[0];
  expect(actualUnitPlay(replay, store.results, ledger)).toMatchObject({
    grade: "Push",
    actual: 75,
    net: 0,
    price: -105,
  });
});

it("rejects source quotes captured after their observation and source boards that reported no current line", () => {
  const { store, original } = fixture();
  original.quotes[1].latestCapturedAt = "2026-11-02T23:59:00Z";
  expect(draftKingsRecord(store, at).records).toHaveLength(0);
  original.quotes[1].latestCapturedAt = original.recordedAt;
  original.prediction.marketCoverage = {
    checkedAt: original.recordedAt,
    source: "https://example.com/board",
    status: "matched",
    books: [{ sportsbook: "draftkings", status: "no_current_line" }],
  };
  expect(draftKingsRecord(store, at).records).toHaveLength(0);
});

it("keeps real DraftKings entries and recorded stakes unchanged and never fills current-day missing entries", () => {
  const { store, original } = fixture();
  const future = {
    method: "last-pretip-v1" as const,
    startedAt: "2026-11-02T20:00:00Z",
    maxQuoteAgeMinutes: 15 as const,
  };
  store.entryPolicy = future;
  expect(draftKingsRecord(store, "2026-11-03T02:00:00Z").records).toHaveLength(
    0,
  );
  delete store.entryPolicy;
  original.sportsbook = "draftkings";
  original.comparison = { line: 75, lean: "UNDER", signedEdge: -1 };
  expect(draftKingsRecord(store, at).records).toEqual([original]);
  const savedLedger: UnitLedger = {
    ...ledger,
    startedAt: original.recordedAt,
    assignments: [
      {
        id: `actual:${original.id}`,
        recordId: original.id,
        source: "actual",
        season: original.season,
        method: original.modelVersion,
        gameId: original.gameId,
        gameDate: original.gameDate,
        assignedAt: original.recordedAt,
        startsAt: original.prediction.startsAt,
        policy: "confidence-units-v1",
        score: 80,
        units: 1.5,
        sportsbook: "draftkings",
        basis: "latest",
        side: "UNDER",
        line: 75,
        price: -105,
      },
    ],
  };
  expect(actualUnitPlay(original, store.results, savedLedger)).toMatchObject({
    mode: "tracked",
    units: 1.5,
    score: 80,
    price: -105,
  });
});

it("replays completed past dates with frozen inputs and DraftKings evidence even when an official final-window entry was missed", () => {
  const { store, original } = fixture();
  store.entryPolicy = {
    method: "last-pretip-v1",
    startedAt: "2026-11-02T20:00:00Z",
    maxQuoteAgeMinutes: 15,
  };
  original.sportsbook = "draftkings";
  const before = structuredClone(store);
  const output = draftKingsRecord(store, "2026-11-03T06:00:00Z");
  expect(output.records).toHaveLength(1);
  expect(output.records[0].replay?.sourceRecordId).toBe(original.id);
  expect(draftKingsRecordIndex(output).canonicalIds).toContain(
    output.records[0].id,
  );
  expect(
    actualUnitPlay(output.records[0], output.results, ledger),
  ).toMatchObject({
    mode: "historical",
    assignedAt: null,
    sportsbook: "draftkings",
  });
  expect(store).toEqual(before);
  expect(ledger.assignments).toHaveLength(0);
});

it("requires a completed first half and a prior Eastern date for supplemental replays", () => {
  const { store } = fixture();
  store.entryPolicy = {
    method: "last-pretip-v1",
    startedAt: "2026-11-02T20:00:00Z",
    maxQuoteAgeMinutes: 15,
  };
  // UTC November 3 is still November 2 in ET.
  expect(draftKingsRecord(store, "2026-11-03T02:00:00Z").records).toHaveLength(
    0,
  );
  store.results = [];
  expect(draftKingsRecord(store, "2026-11-03T06:00:00Z").records).toHaveLength(
    0,
  );
});

it("can replay DraftKings when an older frozen model had no eligible original-book lean", () => {
  const { store, original } = fixture();
  original.comparison = { line: null, signedEdge: null, lean: null };
  const output = draftKingsRecord(store, at);
  expect(output.records).toHaveLength(1);
  expect(output.records[0].comparison).toMatchObject({
    line: 75,
    lean: "UNDER",
  });
  expect(draftKingsRecordIndex(output).canonicalIds).toHaveLength(1);
  expect(actualUnitPlay(output.records[0], output.results, ledger).grade).toBe(
    "Win",
  );
});
