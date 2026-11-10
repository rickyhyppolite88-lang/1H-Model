import { expect, it } from "vitest";
import { type EntryPolicy, verifiedTipoffQuote } from "./entryPolicy";
import { canonicalLabForecasts } from "./lab";
import { labFixture } from "./lab.test-fixture";
import { captureLab } from "./labCapture";
import {
  buildRecordIndex,
  canonicalRecords,
  recordGrade,
  updatePredictionRecord,
} from "./predictionRecord";
import { generatePredictions, workbookPayload } from "./predictions";
import { recordFixture } from "./record.test-fixture";
import { actualUnitPlay, updateUnitLedger } from "./units";

const policy: EntryPolicy = {
  method: "last-pretip-v1",
  startedAt: "2026-11-02T23:40:00Z",
  maxQuoteAgeMinutes: 15,
};

function market(at: string, line: number) {
  const f = recordFixture();
  f.ledger.capturedAt = at;
  f.ledger.games[0].quotes.push({
    ...f.ledger.games[0].quotes[0],
    sportsbook: "draftkings",
    latest: { total: line, overPrice: -115, underPrice: -105 },
    latestCapturedAt: at,
  });
  return { ...f, feed: generatePredictions(f.ledger, at) };
}

it("uses DraftKings for new projections and workbook comparisons", () => {
  const f = market("2026-11-02T23:48:00Z", 80);
  expect(f.feed.defaultSportsbook).toBe("draftkings");
  expect(workbookPayload(f.feed).predictions[0].comparison).toMatchObject({
    line: 80,
    lean: "UNDER",
  });
});

it("updates one future game's selected book, line, direction and stake until tipoff and freezes the last verified snapshot", () => {
  const original = recordFixture();
  const first = updatePredictionRecord(
    original.store,
    original.feed,
    original.ledger,
    original.at,
  );
  const saved = structuredClone(first.records[0]);
  const emptyLab = labFixture().empty;
  const initialLedger = updateUnitLedger(null, first, emptyLab, original.at);
  const f = market("2026-11-02T23:48:00Z", 70);
  const middle = updatePredictionRecord(
    first,
    f.feed,
    f.ledger,
    f.feed.generatedAt,
    { entryPolicy: policy },
  );
  let ledger = updateUnitLedger(
    initialLedger,
    middle,
    emptyLab,
    f.feed.generatedAt,
  );
  const last = market("2026-11-02T23:57:00Z", 80);
  let store = updatePredictionRecord(
    middle,
    last.feed,
    last.ledger,
    last.feed.generatedAt,
  );
  ledger = updateUnitLedger(ledger, store, emptyLab, last.feed.generatedAt);
  expect(store.records[0]).toEqual(saved);
  let selected = canonicalRecords(store.records, store.entryPolicy);
  expect(selected).toHaveLength(1);
  expect(selected[0]).toMatchObject({
    sportsbook: "draftkings",
    comparison: { line: 80, lean: "UNDER" },
  });
  expect(actualUnitPlay(selected[0], [], ledger)).toMatchObject({
    units: 1.5,
    entryPolicy: "last-pretip-v1",
    lineCapturedAt: last.feed.generatedAt,
  });
  // A successful recheck of an unchanged line must retain its fresh verification time.
  const recheck = market("2026-11-02T23:59:00Z", 80);
  store = updatePredictionRecord(
    store,
    recheck.feed,
    recheck.ledger,
    recheck.feed.generatedAt,
  );
  ledger = updateUnitLedger(ledger, store, emptyLab, recheck.feed.generatedAt);
  selected = canonicalRecords(store.records, store.entryPolicy);
  expect(selected[0].recordedAt).toBe(recheck.feed.generatedAt);
  expect(buildRecordIndex(store).canonicalIds).toEqual([selected[0].id]);
  expect(
    ledger.assignments.filter((row) => row.source === "actual"),
  ).toHaveLength(4);
  const finished = market("2026-11-03T00:30:00Z", 60);
  finished.ledger.games[0].firstHalfComplete = true;
  finished.ledger.games[0].away.firstHalfPoints = 41;
  finished.ledger.games[0].home.firstHalfPoints = 41;
  const finalFeed = generatePredictions(
    finished.ledger,
    finished.feed.generatedAt,
  );
  store = updatePredictionRecord(
    store,
    finalFeed,
    finished.ledger,
    finalFeed.generatedAt,
  );
  const finalLedger = updateUnitLedger(
    ledger,
    store,
    emptyLab,
    finalFeed.generatedAt,
  );
  expect(
    canonicalRecords(store.records, store.entryPolicy).map((row) => row.id),
  ).toEqual([selected[0].id]);
  expect(finalLedger.assignments).toEqual(ledger.assignments);
  expect(recordGrade(selected[0], store.results).grade).toBe("Loss");
  expect(actualUnitPlay(selected[0], store.results, finalLedger).net).toBe(
    -1.5,
  );
});

it("does not claim a tipoff entry from a stale quote or fall back to an earlier line after it disappears", () => {
  const old = market("2026-11-02T22:00:00Z", 70);
  let store = updatePredictionRecord(
    old.store,
    old.feed,
    old.ledger,
    old.feed.generatedAt,
    { entryPolicy: policy },
  );
  expect(canonicalRecords(store.records, policy)).toHaveLength(0);
  const fresh = market("2026-11-02T23:57:00Z", 80);
  store = updatePredictionRecord(
    store,
    fresh.feed,
    fresh.ledger,
    fresh.feed.generatedAt,
  );
  expect(canonicalRecords(store.records, policy)).toHaveLength(1);
  const missing = generatePredictions(fresh.ledger, "2026-11-02T23:59:00Z");
  missing.predictions[0].markets = missing.predictions[0].markets.filter(
    (row) => row.sportsbook !== "draftkings",
  );
  store = updatePredictionRecord(
    store,
    missing,
    fresh.ledger,
    missing.generatedAt,
  );
  expect(canonicalRecords(store.records, policy)).toHaveLength(0);
});

it("keeps the original entry for games that tipped before the new policy began", () => {
  const f = market("2026-11-02T23:48:00Z", 70);
  let store = updatePredictionRecord(
    f.store,
    f.feed,
    f.ledger,
    f.feed.generatedAt,
  );
  const first = structuredClone(store.records[0]);
  const next = market("2026-11-02T23:57:00Z", 80);
  store = updatePredictionRecord(
    store,
    next.feed,
    next.ledger,
    next.feed.generatedAt,
  );
  const laterPolicy: EntryPolicy = {
    ...policy,
    startedAt: "2026-11-03T01:00:00Z",
  };
  expect(canonicalRecords(store.records, laterPolicy)).toEqual([first]);
  expect(store.records[0]).toEqual(first);
});

it("uses the last future Lab decision, including a final watch-only decision, while preserving legacy decisions", () => {
  const f = labFixture();
  const config = {
    ...f.config,
    methods: f.config.methods.map((row) => ({
      ...row,
      enabled: row.id === "qualified-baseline-v1",
    })),
  };
  const setup = (at: string, line: number) => {
    const game = f.ledger.games[0];
    game.quotes = [
      {
        ...game.quotes[0],
        sportsbook: "draftkings",
        latest: { total: line, overPrice: -110, underPrice: -110 },
        latestCapturedAt: at,
      },
    ];
    const feed = generatePredictions(f.ledger, at);
    feed.marketCapturedAt = at;
    return feed;
  };
  const firstFeed = setup("2026-11-02T23:48:00Z", 70);
  const first = captureLab(
    f.empty,
    config,
    firstFeed,
    f.ledger,
    f.inputs,
    firstFeed.generatedAt,
    policy,
  );
  const finalFeed = setup("2026-11-02T23:57:00Z", 73.5);
  const final = captureLab(
    first,
    config,
    finalFeed,
    f.ledger,
    f.inputs,
    finalFeed.generatedAt,
    policy,
  );
  expect(first.forecasts[0].status).toBe("qualified");
  const recheckFeed = setup("2026-11-02T23:59:00Z", 73.5);
  const rechecked = captureLab(
    final,
    config,
    recheckFeed,
    f.ledger,
    f.inputs,
    recheckFeed.generatedAt,
    policy,
  );
  expect(
    canonicalLabForecasts(rechecked.forecasts, policy)[0].inputs
      .entryQuoteCapturedAt,
  ).toBe(recheckFeed.generatedAt);
  expect(canonicalLabForecasts(final.forecasts, policy)[0]).toMatchObject({
    sportsbook: "draftkings",
    status: "watch_only",
    line: 73.5,
  });
  expect(
    canonicalLabForecasts(final.forecasts, {
      ...policy,
      startedAt: "2026-11-03T01:00:00Z",
    })[0].id,
  ).toBe(first.forecasts[0].id);
});

it("requires a verified source check in the final 15 minutes for future entries", () => {
  expect(
    verifiedTipoffQuote("2026-11-03T00:00:00Z", "2026-11-02T23:45:00Z", policy),
  ).toBe(true);
  for (const at of [
    null,
    "2026-11-02T23:44:59Z",
    "2026-11-03T00:00:00Z",
    "2026-11-03T00:01:00Z",
  ])
    expect(verifiedTipoffQuote("2026-11-03T00:00:00Z", at, policy)).toBe(false);
});

it("keeps known past games on their earlier entries even if a later schedule edit moves the timestamp forward", () => {
  const f = market("2026-11-02T23:48:00Z", 70);
  let store = updatePredictionRecord(
    f.store,
    f.feed,
    f.ledger,
    f.feed.generatedAt,
  );
  const first = structuredClone(store.records[0]);
  const next = market("2026-11-03T00:10:00Z", 80);
  next.ledger.games[0].startsAt = "2026-11-03T00:15:00Z";
  const feed = generatePredictions(next.ledger, next.feed.generatedAt);
  store = updatePredictionRecord(store, feed, next.ledger, feed.generatedAt);
  expect(
    canonicalRecords(store.records, {
      ...policy,
      legacyGameKeys: [`${f.feed.season}:game`],
    }),
  ).toEqual([first]);
});

it("can verify a legitimately delayed upcoming game's final line after its earlier scheduled time", () => {
  const f = market("2026-11-02T23:48:00Z", 70);
  let store = updatePredictionRecord(
    f.store,
    f.feed,
    f.ledger,
    f.feed.generatedAt,
    { entryPolicy: policy },
  );
  const emptyLab = labFixture().empty;
  const firstLedger = updateUnitLedger(
    null,
    store,
    emptyLab,
    f.feed.generatedAt,
  );
  const delayed = market("2026-11-03T00:12:00Z", 80);
  delayed.ledger.games[0].startsAt = "2026-11-03T00:15:00Z";
  const feed = generatePredictions(delayed.ledger, delayed.feed.generatedAt);
  store = updatePredictionRecord(store, feed, delayed.ledger, feed.generatedAt);
  const selected = canonicalRecords(store.records, policy)[0];
  const ledger = updateUnitLedger(
    firstLedger,
    store,
    emptyLab,
    feed.generatedAt,
  );
  expect(selected.comparison.line).toBe(80);
  expect(actualUnitPlay(selected, [], ledger)).toMatchObject({
    mode: "tracked",
    units: 1.5,
    assignedAt: feed.generatedAt,
  });
});
