import { expect, it } from "vitest";
import { canonicalLabForecasts, gradeLab, type LabStore } from "./lab";
import { labDisplayStore } from "./labDisplay";
import { captureResearchForecast } from "./labResearch";
import { researchFixture } from "./labResearch.test-fixture";

it("retains the last usable entry and later gap, with the same canonical result and original archive untouched", () => {
  const f = researchFixture();
  const base = captureResearchForecast(
    "market-paper-v3",
    f.row,
    f.game,
    f.feed,
    f.model,
    f.modelPath,
    f.halves,
    f.refs,
    f.at,
  );
  if (!base.research) throw new Error("Missing frozen research metadata");
  const a = {
    ...base,
    id: "early",
    recordedAt: "2026-11-02T23:40:00Z",
    version: 1,
  };
  const b = {
    ...base,
    id: "entry",
    recordedAt: "2026-11-02T23:50:00Z",
    version: 2,
  };
  const c = {
    ...base,
    id: "gap",
    recordedAt: "2026-11-02T23:55:00Z",
    version: 3,
    status: "data_gap" as const,
    research: { ...base.research, probability: null, paperUnits: 0 as const },
  };
  const result = {
    id: "result",
    season: base.season,
    gameId: base.gameId,
    startsAt: base.startsAt,
    observedAt: "2026-11-03T01:00:00Z",
    sourceCapturedAt: "2026-11-03T01:00:00Z",
    source: "https://example.com/score",
    awayPoints: 36,
    homePoints: 36,
  };
  const store: LabStore = {
    schemaVersion: 1,
    startedAt: a.recordedAt,
    updatedAt: result.observedAt,
    forecasts: [a, b, c],
    results: [
      { ...result, id: "older-result", observedAt: "2026-11-03T00:50:00Z" },
      result,
    ],
    halves: [],
  };
  const original = JSON.stringify(store),
    display = labDisplayStore(store);
  expect(display.forecasts.map((r) => r.id)).toEqual(["entry", "gap"]);
  expect(display.results).toEqual([result]);
  expect(canonicalLabForecasts(display.forecasts)).toEqual(
    canonicalLabForecasts(store.forecasts),
  );
  expect(gradeLab(b, display)).toEqual(gradeLab(b, store));
  expect(JSON.stringify(store)).toBe(original);
});
