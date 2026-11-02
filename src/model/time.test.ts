import { describe, expect, it } from "vitest";
import { easternTipoff } from "./time";

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
