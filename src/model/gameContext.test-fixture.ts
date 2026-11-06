import { contextModelSchema } from "./gameContext";
import { recordFixture } from "./record.test-fixture";

export const contextModelPath = `data/context-models/${"a".repeat(64)}.json`;
export function contextFixture() {
  const f = recordFixture();
  const game = f.ledger.games[0];
  game.context = {
    neutralSite: false,
    conferenceGame: false,
    matchupType: "nonconference_regular",
    eventLabel: null,
    venueId: "1",
    venueKey: "id:1",
    venueName: "Test Arena",
    city: "Test",
    state: "NY",
  };
  game.contextRetrievedAt = f.at;
  const profile = {
    games: 30,
    signedLocation: 0,
    neutral: 0,
    "type:nonconference_regular": 1,
    "type:conference_regular": 0,
    "crowd:medium": 0,
    "crowd:large": 0,
  };
  const model = contextModelSchema.parse({
    schemaVersion: 1,
    modelVersion: "lab-context-v1",
    fittedAt: "2026-11-02T19:00:00Z",
    latestGameAt: "2026-11-01T20:00:00Z",
    historySha256: "b".repeat(64),
    trainingGames: 500,
    trainingSeasons: ["2025-26", "2026-27"],
    rules: {
      version: "test",
      maximumAdjustment: 4,
      minimumCrowdAttendance: 3000,
      minimumVenueAttendances: 3,
    },
    converged: true,
    iterations: 20,
    coefficients: {
      "location:a": 1,
      "location:b": 2,
      neutral: -1,
      "type:conference_regular": -1,
      "type:nonconference_regular": 0,
      "crowd:large": 1,
    },
    profiles: { "2025-26:a": profile, "2025-26:b": profile },
    leagueProfiles: { "2025-26": profile },
    locationCounts: { a: { home: 15, away: 15 }, b: { home: 15, away: 15 } },
    contextCounts: { neutral: 50 },
    venues: { "id:1": { games: 10, attendanceTotal: 100000 } },
    sourceErrors: [],
  });
  return { ...f, game, model };
}
