import { describe, expect, it } from "vitest";
import { describeLineMovement, type RecordedLinePick } from "./lineMovement";
import { recordFixture } from "./record.test-fixture";

function fixture(
  opening: number | null,
  latest: number | null,
  total: number | null = 74,
) {
  const row = recordFixture().feed.predictions[0];
  row.projectedFirstHalfTotal = total;
  row.markets[0].openingLine = opening;
  row.markets[0].latestLine = latest;
  return row;
}

describe("current-line movement and pick impact", () => {
  it("measures the selected book's current-minus-opening total and reports a reduced edge", () => {
    const row = fixture(70, 72);
    row.markets.push({
      ...row.markets[0],
      sportsbook: "other",
      openingLine: 80,
      latestLine: 79,
    });
    expect(describeLineMovement(row, "betmgm")).toMatchObject({
      delta: 2,
      direction: "up",
      modelImpact: "OVER edge shrank by 2.0 points (4.0 → 2.0).",
    });
    expect(describeLineMovement(row, "other")).toMatchObject({
      delta: -1,
      direction: "down",
      modelImpact: "UNDER edge shrank by 1.0 points (6.0 → 5.0).",
    });
    expect(describeLineMovement(row, "missing")).toMatchObject({
      delta: null,
      opening: null,
      current: null,
    });
  });
  it.each([
    [70, 76, "Model lean flips OVER → UNDER."],
    [78, 72, "Model lean flips UNDER → OVER."],
    [70, 74, "Move removes the opening OVER lean."],
    [74, 72, "Move creates an OVER lean"],
  ])(
    "explains crossing the model total from %s to %s",
    (opening, latest, text) => {
      expect(
        describeLineMovement(fixture(opening, latest), "betmgm").modelImpact,
      ).toContain(text);
    },
  );
  it("handles unchanged totals and missing inputs without substituting another line", () => {
    expect(describeLineMovement(fixture(70, 70), "betmgm")).toMatchObject({
      delta: 0,
      direction: "unchanged",
    });
    expect(describeLineMovement(fixture(null, 72), "betmgm")).toMatchObject({
      delta: null,
      current: 72,
      opening: null,
    });
    expect(describeLineMovement(fixture(70, null), "betmgm")).toMatchObject({
      delta: null,
      current: null,
      opening: 70,
    });
    expect(
      describeLineMovement(fixture(70, 72, null), "betmgm").modelImpact,
    ).toContain("No valid model projection");
  });
  it.each([
    ["OVER", 72, "less"],
    ["OVER", 68, "more"],
    ["UNDER", 72, "more"],
    ["UNDER", 68, "less"],
  ] as const)(
    "compares a new %s at %s with the original saved line",
    (side, current, effect) => {
      const pick: RecordedLinePick = {
        line: 70,
        side,
        actual: null,
        grade: "Pending",
      };
      const details = describeLineMovement(
        fixture(69, current),
        "betmgm",
        pick,
      );
      expect(details.recordedImpact).toContain(
        `2.0 points ${effect} favorable`,
      );
      expect(details.recordedImpact).toContain(
        "keeps its original line and pending status",
      );
      expect(details.hypotheticalGrade).toBeNull();
      expect(pick).toEqual({ line: 70, side, actual: null, grade: "Pending" });
    },
  );
  it.each([
    ["OVER", 70, 72, 71, "Loss"],
    ["UNDER", 72, 70, 71, "Loss"],
    ["OVER", 70, 71, 71, "Push"],
  ] as const)(
    "compares settled %s outcomes without changing the official grade",
    (side, savedLine, current, actual, grade) => {
      const pick: RecordedLinePick = {
        line: savedLine,
        side,
        actual,
        grade: "Win",
      };
      const result = describeLineMovement(
        fixture(savedLine, current),
        "betmgm",
        pick,
      );
      expect(result.hypotheticalGrade).toBe(grade);
      expect(result.recordedImpact).toContain(
        "Official result remains Win at the saved line.",
      );
      expect(pick.grade).toBe("Win");
    },
  );
  it("does not infer a settled comparison for a pending schedule-review result", () => {
    expect(
      describeLineMovement(fixture(70, 72), "betmgm", {
        line: 70,
        side: "OVER",
        actual: 71,
        grade: "Pending",
      }).hypotheticalGrade,
    ).toBeNull();
    expect(
      describeLineMovement(fixture(70, 72), "betmgm", undefined, "loading")
        .recordedImpact,
    ).toContain("Loading");
    expect(
      describeLineMovement(fixture(70, 72), "betmgm", undefined, "error")
        .recordedImpact,
    ).toContain("cannot be checked");
  });
});
