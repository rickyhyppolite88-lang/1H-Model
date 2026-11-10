import { describe, expect, it } from "vitest";
import { recordGrade, updatePredictionRecord } from "./predictionRecord";
import { generatePredictions } from "./predictions";
import { recordFixture } from "./record.test-fixture";
import { reviewSchedule } from "./scheduleReview";

const participants = {
  away: { espnId: "79", modelId: "siu", name: "Southern Illinois" },
  home: { espnId: "140", modelId: "kc", name: "Kansas City" },
};
const saved = {
  season: "2026-27",
  gameId: "401920952",
  startsAt: "2026-11-07T01:30:00Z",
  recordedAt: "2026-11-06T21:31:00Z",
  awayTeam: participants.away.name,
  homeTeam: participants.home.name,
  participants,
};
const result = {
  season: saved.season,
  gameId: saved.gameId,
  startsAt: "2026-11-07T02:15:00Z",
  observedAt: "2026-11-07T05:00:00Z",
  sourceCapturedAt: "2026-11-07T04:59:00Z",
  source:
    "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261106",
  participants,
};

describe("verified schedule corrections", () => {
  it("accepts the same-day 45-minute delay and equivalent timestamp representations", () => {
    expect(reviewSchedule(saved, result)).toBe("verified_time_change");
    expect(
      reviewSchedule(saved, {
        ...result,
        startsAt: "2026-11-07T01:30:00.000Z",
      }),
    ).toBe("unchanged");
  });
  it.each([
    { ...result, participants: undefined },
    { ...result, source: "https://example.com/result" },
    { ...result, gameId: "another-game" },
    { ...result, season: "2025-26" },
    {
      ...result,
      participants: { away: participants.home, home: participants.away },
    },
    {
      ...result,
      participants: {
        ...participants,
        away: { ...participants.away, espnId: "999" },
      },
    },
    { ...result, startsAt: "2026-11-08T02:15:00Z" },
    { ...result, startsAt: "2026-11-06T18:00:00Z" },
    { ...result, sourceCapturedAt: "2026-11-07T02:00:00Z" },
  ])("holds unverified or unsafe changes for review (%#)", (changed) => {
    expect(reviewSchedule(saved, changed)).toBe("review");
  });
  it("rejects a forecast captured after an earlier corrected tipoff", () => {
    expect(
      reviewSchedule(
        { ...saved, recordedAt: "2026-11-07T01:00:00Z" },
        { ...result, startsAt: "2026-11-07T00:45:00Z" },
      ),
    ).toBe("review");
  });
  it("requires the Lab's saved venue and matchup context to remain the same", () => {
    const context = {
      neutralSite: false,
      conferenceGame: false,
      matchupType: "nonconference_regular" as const,
      eventLabel: null,
      venueId: "1",
      venueKey: "id:1",
      venueName: "Arena",
      city: null,
      state: null,
    };
    expect(reviewSchedule({ ...saved, context }, { ...result, context })).toBe(
      "verified_time_change",
    );
    expect(
      reviewSchedule(
        { ...saved, context },
        { ...result, context: { ...context, venueKey: "id:2" } },
      ),
    ).toBe("review");
    expect(reviewSchedule({ ...saved, context }, result)).toBe("review");
  });
  it("appends identity evidence and grades both winning and losing corrected outcomes without rewriting forecasts", () => {
    const f = recordFixture();
    let store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const frozen = structuredClone(store.records[0]);
    const game = f.ledger.games[0];
    game.startsAt = "2026-11-03T00:45:00Z";
    game.firstHalfComplete = true;
    game.away.firstHalfPoints = 42;
    game.home.firstHalfPoints = 55;
    game.scoresSource = result.source;
    game.capturedAt = "2026-11-03T02:00:00Z";
    store = updatePredictionRecord(
      store,
      generatePredictions(f.ledger, game.capturedAt),
      f.ledger,
      game.capturedAt,
    );
    expect(recordGrade(frozen, store.results)).toMatchObject({
      grade: "Win",
      schedule: "verified_time_change",
      actual: 97,
    });
    const firstResult = structuredClone(store.results[0]);
    game.home.firstHalfPoints = 20;
    game.capturedAt = "2026-11-03T02:10:00Z";
    store = updatePredictionRecord(
      store,
      generatePredictions(f.ledger, game.capturedAt),
      f.ledger,
      game.capturedAt,
    );
    expect(recordGrade(frozen, store.results)).toMatchObject({
      grade: "Loss",
      schedule: "verified_time_change",
      actual: 62,
    });
    expect(store.results).toHaveLength(2);
    expect(store.results[0]).toEqual(firstResult);
    expect(store.records.find((r) => r.id === frozen.id)).toEqual(frozen);
  });
});
