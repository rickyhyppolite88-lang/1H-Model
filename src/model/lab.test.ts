import { describe, expect, it } from "vitest";
import {
  canonicalLabForecasts,
  gradeLab,
  labSummary,
  labToCsv,
  mergeLabStores,
} from "./lab";
import { labFixture } from "./lab.test-fixture";
import { captureLab, expectedBonusMinutes } from "./labCapture";

describe("separate prospective Lab", () => {
  it("does not count a stale quote as a fresh experimental entry", () => {
    const f = labFixture();
    f.feed.marketCapturedAt = "2026-11-02T21:00:00Z";
    let store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
    expect(
      store.forecasts.find((row) => row.methodId === "qualified-baseline-v1"),
    ).toMatchObject({
      status: "data_gap",
      line: null,
      inputs: { lastSeenLine: 70 },
    });
    f.feed.marketCapturedAt = f.at;
    f.feed.predictions[0].markets[0].capturedAt = "2026-11-02T21:00:00Z";
    store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
    expect(
      store.forecasts.find((row) => row.methodId === "baseline-control-v1")
        ?.line,
    ).toBeNull();
    expect(
      store.forecasts.find((row) => row.methodId === "bonus-exposure-v1")
        ?.status,
    ).toBe("measurement");
  });
  it("captures all four experiments without mutating actual forecasts or using a bonus betting adjustment", () => {
    const f = labFixture();
    const original = JSON.stringify({ feed: f.feed, ledger: f.ledger });
    const store = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    );
    expect(store.forecasts).toHaveLength(4);
    expect(JSON.stringify({ feed: f.feed, ledger: f.ledger })).toBe(original);
    const defense = store.forecasts.find(
      (row) => row.methodId === "first-half-defense-v1",
    );
    expect(defense?.inputs.awayFirstHalfAllowed).toBe(31.75);
    expect(defense?.inputs.homeFirstHalfAllowed).toBe(38.25);
    expect(defense?.total).toBeCloseTo(((74 + 70) / 2) * 0.6 + 73.5 * 0.4);
    const bonus = store.forecasts.find(
      (row) => row.methodId === "bonus-exposure-v1",
    );
    expect(bonus?.status).toBe("measurement");
    expect(bonus?.total).toBeNull();
    expect(bonus?.side).toBeNull();
    expect(bonus?.bonusMinutes).toBeGreaterThan(0);
    expect(bonus?.signalStrength).toBeNull();
  });

  it("deduplicates unchanged captures and versions changed lines without replacing earlier observations", () => {
    const f = labFixture();
    const first = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    );
    const later = "2026-11-02T22:10:00Z";
    expect(
      captureLab(first, f.config, f.feed, f.ledger, f.inputs, later).forecasts,
    ).toEqual(first.forecasts);
    f.feed.predictions[0].markets[0].latestLine = 73;
    const next = captureLab(first, f.config, f.feed, f.ledger, f.inputs, later);
    expect(next.forecasts).toHaveLength(8);
    expect(next.forecasts.slice(0, 4)).toEqual(first.forecasts);
    expect(
      canonicalLabForecasts(next.forecasts).map((row) => row.line),
    ).toEqual([70, 70, 70, 70]);
  });

  it("never backfills forecasts after tipoff or uses a later feature/quote as pregame evidence", () => {
    const f = labFixture();
    expect(
      captureLab(
        f.empty,
        f.config,
        f.feed,
        f.ledger,
        f.inputs,
        "2026-11-03T00:01:00Z",
      ).forecasts,
    ).toHaveLength(0);
    f.feed.predictions[0].markets[0].capturedAt = "2026-11-02T23:00:00Z";
    expect(
      captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at).forecasts,
    ).toHaveLength(0);
    expect(() =>
      captureLab(
        { ...f.empty, updatedAt: "2026-11-02T23:00:00Z" },
        f.config,
        f.feed,
        f.ledger,
        f.inputs,
        f.at,
      ),
    ).toThrow(/backdate/);
  });

  it.each([
    [73, 73.1, 73.2, "watch_only"],
    [72, 70, 74, "watch_only"],
    [79, 79, 79, "watch_only"],
    [73, 73, 73, "qualified"],
  ])(
    "applies predeclared qualification to %s without changing the original total",
    (total, simple, pace, expected) => {
      const f = labFixture();
      Object.assign(f.feed.predictions[0], {
        projectedFirstHalfTotal: total,
        simpleTotal: simple,
        paceAdjustedTotal: pace,
      });
      f.feed.predictions[0].markets[0].latestLine =
        expected === "watch_only" && total === 73 ? 72 : 70;
      const store = captureLab(
        f.empty,
        f.config,
        f.feed,
        f.ledger,
        f.inputs,
        f.at,
      );
      const row = store.forecasts.find(
        (entry) => entry.methodId === "qualified-baseline-v1",
      );
      expect(row?.status).toBe(expected);
      expect(row?.total).toBe(total);
    },
  );

  it("keeps missing defensive inputs as a gap and blocks mismatched/future datasets", () => {
    const f = labFixture();
    f.inputs.prior.teams[0].firstHalfAllowed = null;
    const first = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    );
    expect(
      first.forecasts.find((row) => row.methodId === "first-half-defense-v1")
        ?.status,
    ).toBe("data_gap");
    expect(
      first.forecasts.find((row) => row.methodId === "qualified-baseline-v1")
        ?.status,
    ).toBe("qualified");
    f.inputs.prior.retrievedAt = "2026-11-02T23:00:00Z";
    expect(
      captureLab(
        f.empty,
        f.config,
        f.feed,
        f.ledger,
        f.inputs,
        f.at,
      ).forecasts.find((row) => row.methodId === "first-half-defense-v1")
        ?.total,
    ).toBeNull();
  });

  it("does not use future or current-game play-by-play for bonus forecasts", () => {
    const f = labFixture();
    for (const half of f.inputs.halves)
      half.observedAt = "2026-11-03T01:00:00Z";
    let store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
    expect(
      store.forecasts.find((row) => row.methodId === "bonus-exposure-v1")
        ?.status,
    ).toBe("data_gap");
    for (const half of f.inputs.halves) {
      half.observedAt = "2026-11-01T22:00:00Z";
      half.gameId = f.ledger.games[0].id;
    }
    store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
    expect(
      store.forecasts.find((row) => row.methodId === "bonus-exposure-v1")
        ?.bonusMinutes,
    ).toBeNull();
  });

  it("pauses future collection without deleting history, and retains first watch-only decisions", () => {
    const f = labFixture();
    f.feed.predictions[0].markets[0].latestLine = 73.5;
    const first = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    );
    f.feed.predictions[0].markets[0].latestLine = 70;
    const later = "2026-11-02T22:10:00Z";
    const next = captureLab(first, f.config, f.feed, f.ledger, f.inputs, later);
    expect(
      canonicalLabForecasts(next.forecasts).find(
        (row) => row.methodId === "qualified-baseline-v1",
      )?.status,
    ).toBe("watch_only");
    for (const method of f.config.methods) method.enabled = false;
    expect(
      captureLab(first, f.config, f.feed, f.ledger, f.inputs, later).forecasts,
    ).toEqual(first.forecasts);
  });

  it("waits for the first available priced forecast and never substitutes another book", () => {
    const f = labFixture();
    f.feed.predictions[0].markets[0].latestLine = null;
    const first = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    );
    expect(
      first.forecasts.find((row) => row.methodId === "qualified-baseline-v1")
        ?.status,
    ).toBe("data_gap");
    f.feed.predictions[0].markets[0].latestLine = 70;
    const next = captureLab(
      first,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      "2026-11-02T22:10:00Z",
    );
    expect(
      canonicalLabForecasts(next.forecasts).find(
        (row) => row.methodId === "qualified-baseline-v1",
      )?.line,
    ).toBe(70);
  });

  it("grades only qualified decisions, retains watch-only hypotheticals and handles corrections and schedule review", () => {
    const f = labFixture();
    const store = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    );
    const row = store.forecasts.find(
      (entry) => entry.methodId === "qualified-baseline-v1",
    );
    if (!row) throw new Error("fixture");
    expect(gradeLab(row, store).grade).toBe("Pending");
    store.results = [
      {
        id: "result",
        season: row.season,
        gameId: row.gameId,
        observedAt: "2026-11-03T01:00:00Z",
        startsAt: row.startsAt,
        sourceCapturedAt: "2026-11-03T01:00:00Z",
        awayPoints: 36,
        homePoints: 36,
        source: "https://example.com/result",
      },
    ];
    expect(gradeLab(row, store).grade).toBe("Win");
    expect(labSummary([row], store)).toMatchObject({
      wins: 1,
      losses: 0,
      baselineWins: 1,
      watchOnly: 0,
    });
    const watch = { ...row, status: "watch_only" as const };
    expect(gradeLab(watch, store)).toMatchObject({
      grade: "Watch only",
      actual: 72,
      hypothetical: "Win",
    });
    expect(labSummary([watch], store)).toMatchObject({
      wins: 0,
      watchOnly: 1,
      winRate: null,
    });
    store.results.push({
      ...store.results[0],
      id: "correction",
      observedAt: "2026-11-03T01:10:00Z",
      homePoints: 33,
    });
    expect(gradeLab(row, store).grade).toBe("Loss");
    store.results[1].startsAt = "2026-11-03T00:30:00Z";
    expect(gradeLab(row, store)).toMatchObject({
      grade: "Schedule review",
      error: null,
    });
    expect(labSummary([row], store).wins).toBe(0);
    expect(labToCsv(store)).toContain("signal_strength_NOT_probability");
  });

  it("measures bonus timing separately from wins and fails on conflicting immutable copies", () => {
    const f = labFixture();
    const store = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    );
    const row = store.forecasts.find(
      (entry) => entry.methodId === "bonus-exposure-v1",
    );
    if (!row) throw new Error("fixture");
    store.results = [
      {
        id: "result",
        season: row.season,
        gameId: row.gameId,
        observedAt: "2026-11-03T01:00:00Z",
        sourceCapturedAt: "2026-11-03T01:00:00Z",
        awayPoints: 36,
        homePoints: 36,
        source: "https://example.com/result",
      },
    ];
    store.halves = [
      {
        ...f.inputs.halves[0],
        id: "actual-half",
        teams: f.inputs.halves[0].teams.map((team) => ({
          ...team,
          points: 36,
        })),
        gameId: row.gameId,
        startsAt: row.startsAt,
        observedAt: "2026-11-03T01:01:00Z",
      },
    ];
    expect(gradeLab(row, store)).toMatchObject({
      grade: "Measured",
      actualBonus: 10,
      actual: 72,
    });
    expect(labSummary([row], store)).toMatchObject({
      wins: 0,
      losses: 0,
      winRate: null,
      measured: 1,
    });
    store.halves[0].teams[0].points = 30;
    expect(gradeLab(row, store).grade).toBe("Pending measurement");
    expect(() =>
      mergeLabStores(
        [store, { ...store, forecasts: [{ ...row, total: 100 }] }],
        store.startedAt,
        store.updatedAt,
      ),
    ).toThrow(/Conflicting/);
  });

  it("bounds the bonus proxy and increases it with expected foul volume", () => {
    expect(expectedBonusMinutes(0)).toBe(0);
    expect(expectedBonusMinutes(8)).toBeLessThan(expectedBonusMinutes(12));
    expect(expectedBonusMinutes(30)).toBeLessThan(20);
    expect(() => expectedBonusMinutes(-1)).toThrow();
  });
});
