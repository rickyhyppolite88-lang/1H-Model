import { describe, expect, it } from "vitest";
import { easternTipoff, tipoffState } from "./time";

describe("Eastern game times", () => {
  it.each([
    ["2026-11-03T00:00:00Z", "2026-11-02", "7:00 PM", "EST"],
    ["2026-07-03T00:00:00Z", "2026-07-02", "8:00 PM", "EDT"],
    ["2026-03-08T06:30:00Z", "2026-03-08", "1:30 AM", "EST"],
    ["2026-03-08T07:30:00Z", "2026-03-08", "3:30 AM", "EDT"],
    ["2026-11-01T05:30:00Z", "2026-11-01", "1:30 AM", "EDT"],
    ["2026-11-01T06:30:00Z", "2026-11-01", "1:30 AM", "EST"],
  ])(
    "converts %s with the correct date and daylight-saving offset",
    (timestamp, date, time, zone) => {
      expect(easternTipoff(timestamp)).toEqual({ date, time, zone });
    },
  );
  it("rejects invalid source times", () => {
    expect(() => easternTipoff("invalid")).toThrow("Invalid game timestamp");
  });
});

describe("tipoff status", () => {
  const now = Date.parse("2026-11-03T23:00:00Z");
  it.each([
    ["2026-11-03T23:01:00Z", "Scheduled", null, "upcoming"],
    ["2026-11-03T23:00:00Z", "Scheduled", null, "started"],
    ["2026-11-03T22:59:00Z", "Scheduled", null, "started"],
    ["2026-11-04T00:00:00Z", "In Progress", null, "started"],
    ["2026-11-04T00:00:00Z", "Scheduled", 0, "started"],
    ["2026-11-04T00:00:00Z", "Final", 70, "started"],
    ["2026-11-03T22:00:00Z", "Delayed", null, "upcoming"],
    ["2026-11-03T22:00:00Z", "Postponed", null, "inactive"],
    ["2026-11-04T00:00:00Z", "Canceled", null, "inactive"],
  ] as const)(
    "classifies %s / %s correctly",
    (startsAt, status, actualFirstHalfTotal, expected) => {
      expect(tipoffState({ startsAt, status, actualFirstHalfTotal }, now)).toBe(
        expected,
      );
    },
  );
});
