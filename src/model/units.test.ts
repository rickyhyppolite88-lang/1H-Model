import { describe, expect, it } from "vitest";
import { labFixture } from "./lab.test-fixture";
import { captureLab } from "./labCapture";
import { updatePredictionRecord } from "./predictionRecord";
import { recordFixture } from "./record.test-fixture";
import {
  actualUnitPlay,
  labUnitPlay,
  savedRecordPrice,
  settleUnits,
  summarizeUnits,
  unitLedgerSchema,
  unitPlaysCsv,
  unitsForScore,
  updateUnitLedger,
} from "./units";

function fixture() {
  const f = recordFixture();
  const actual = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  actual.records[0].signal.score = 80;
  const l = labFixture();
  const lab = captureLab(l.empty, l.config, l.feed, l.ledger, l.inputs, l.at);
  return { ...f, actual, lab };
}

describe("confidence unit accounting", () => {
  it("uses the four requested stake tiers without assigning a stake to missing or invalid scores", () => {
    expect([0, 59, 60, 74, 75, 89, 90, 100].map(unitsForScore)).toEqual([
      0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2,
    ]);
    for (const value of [null, -1, 101, Number.NaN])
      expect(unitsForScore(value)).toBeNull();
  });
  it("settles American odds as amount risked, with pushes and missing odds handled explicitly", () => {
    expect(settleUnits(2, -110, "Win")).toBeCloseTo(1.8181818);
    expect(settleUnits(0.5, 150, "Win")).toBe(0.75);
    expect(settleUnits(1.5, -115, "Loss")).toBe(-1.5);
    expect(settleUnits(2, -110, "Push")).toBe(0);
    for (const price of [null, 0, 50, -50])
      expect(settleUnits(2, price, "Win")).toBeNull();
    expect(settleUnits(2, -110, "Pending")).toBeNull();
  });
  it("locks the first canonical stake and original matching line/side price; reruns and later versions cannot resize it", () => {
    const f = fixture();
    const oldRecords = JSON.stringify(f.actual.records);
    const first = updateUnitLedger(null, f.actual, f.lab, f.at);
    const stake = first.assignments.find((row) => row.source === "actual");
    expect(stake).toMatchObject({
      units: 1.5,
      score: 80,
      price: -115,
      line: 70,
      side: "OVER",
    });
    const next = structuredClone(f.actual.records[0]);
    next.id = "later";
    next.version = 2;
    next.recordedAt = "2026-11-02T22:10:00Z";
    next.signal.score = 95;
    f.actual.records.push(next);
    const second = updateUnitLedger(first, f.actual, f.lab, next.recordedAt);
    expect(second.assignments).toEqual(first.assignments);
    expect(JSON.stringify(f.actual.records.slice(0, 1))).toBe(oldRecords);
    expect(first.updatedAt).toBe(f.at);
    expect(() => updateUnitLedger(second, f.actual, f.lab, f.at)).toThrow(
      "backdate",
    );
  });
  it("never stakes a finished, tipped, unscored, or watch-only play and keeps Lab separate", () => {
    const f = fixture();
    const canonical = f.lab.forecasts.find((row) => row.status === "qualified");
    if (!canonical) throw new Error("qualified fixture missing");
    canonical.signalStrength = 95;
    const ledger = updateUnitLedger(null, f.actual, f.lab, f.at);
    expect(
      ledger.assignments.find((row) => row.recordId === canonical.id),
    ).toMatchObject({ source: "lab", units: 2 });
    expect(
      ledger.assignments.every(
        (row) =>
          row.source === "actual" ||
          f.lab.forecasts.find((forecast) => forecast.id === row.recordId)
            ?.status === "qualified",
      ),
    ).toBe(true);
    f.actual.records[0].signal.score = null;
    f.lab.forecasts = [];
    expect(
      updateUnitLedger(null, f.actual, f.lab, f.at).assignments,
    ).toHaveLength(0);
    f.actual.records[0].signal.score = 95;
    expect(
      updateUnitLedger(null, f.actual, f.lab, "2026-11-03T00:00:00Z")
        .assignments,
    ).toHaveLength(0);
    f.actual.results.push({
      id: "result",
      season: f.feed.season,
      gameId: "game",
      observedAt: f.at,
      sourceCapturedAt: f.at,
      source: "https://example.com",
      awayPoints: 36,
      homePoints: 36,
    });
    expect(
      updateUnitLedger(null, f.actual, f.lab, f.at).assignments,
    ).toHaveLength(0);
  });
  it("does not invent odds or use a quote for another line", () => {
    const f = fixture();
    const row = f.actual.records[0];
    row.basis = "opening";
    row.comparison.lean = "UNDER";
    expect(savedRecordPrice(row)).toBe(-110);
    row.comparison.line = 70.5;
    expect(savedRecordPrice(row)).toBeNull();
  });
  it("labels old 1u replays and never presents a later-derived score as a saved stake", () => {
    const f = fixture();
    const ledger = updateUnitLedger(
      null,
      f.actual,
      f.lab,
      "2026-11-03T01:00:00Z",
    );
    f.actual.results.push({
      id: "result",
      season: f.feed.season,
      gameId: "game",
      observedAt: "2026-11-03T01:00:00Z",
      sourceCapturedAt: "2026-11-03T01:00:00Z",
      source: "https://example.com",
      awayPoints: 36,
      homePoints: 36,
    });
    const play = actualUnitPlay(f.actual.records[0], f.actual.results, ledger);
    expect(play).toMatchObject({ mode: "historical", units: 1, grade: "Win" });
    expect(play.net).toBeCloseTo(100 / 115);
    expect(
      actualUnitPlay(f.actual.records[0], f.actual.results, null).net,
    ).toBeNull();
    const watch = f.lab.forecasts.find((row) => row.status === "control");
    if (watch) expect(labUnitPlay(watch, f.lab, ledger).units).toBeNull();
    expect(unitPlaysCsv([play])).toContain("historical_1u_simulation");
    expect(
      summarizeUnits([
        play,
        { ...play, id: "review", grade: "Pending", net: null },
      ]),
    ).toMatchObject({ settled: 1, unresolved: 1, wins: 1, risk: 1 });
  });
  it("rejects duplicate and backdated assignments in persisted ledgers", () => {
    const f = fixture();
    const ledger = updateUnitLedger(null, f.actual, f.lab, f.at);
    expect(() =>
      unitLedgerSchema.parse({
        ...ledger,
        assignments: [...ledger.assignments, ledger.assignments[0]],
      }),
    ).toThrow();
    expect(() =>
      unitLedgerSchema.parse({ ...ledger, startedAt: "2026-11-02T23:00:00Z" }),
    ).toThrow();
  });
});
