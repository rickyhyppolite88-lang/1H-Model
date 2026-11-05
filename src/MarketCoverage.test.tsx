// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MarketCoverage from "./MarketCoverage";
import { recordFixture } from "./model/record.test-fixture";

afterEach(cleanup);

it("exposes stale captures, other-book coverage, and source lines lost to unmatched games", () => {
  const { feed, at } = recordFixture();
  const base = feed.predictions[0];
  feed.predictions = [
    base,
    {
      ...base,
      gameId: "other",
      markets: [{ ...base.markets[0], sportsbook: "draftkings" }],
    },
    { ...base, gameId: "gap", projectedFirstHalfTotal: null, markets: [] },
  ];
  feed.marketChecks = [
    {
      date: "2026-11-02",
      checkedAt: "2026-11-02T21:00:00Z",
      source: "https://example.com/odds",
      boardGames: 4,
      matchedGames: 3,
      unmatchedGames: 1,
      books: [
        {
          sportsbook: "fanduel",
          sourceLines: 1,
          importedLines: 0,
          unmatchedLines: 1,
        },
      ],
    },
  ];
  feed.unmatchedMarkets = [
    {
      oddsGameId: "unknown",
      away: "Unmatched team",
      home: "Opponent",
      source: "https://example.com/odds",
      booksWithLines: ["fanduel"],
    },
  ];
  const show = vi.fn();
  render(
    <MarketCoverage
      feed={feed}
      rows={feed.predictions}
      date="2026-11-02"
      book="betmgm"
      now={Date.parse(at)}
      onShowGaps={show}
    />,
  );
  expect(
    screen.getByText(/1\/3 lines captured · 1 missing here.*1 projection gaps/),
  ).toBeTruthy();
  expect(
    screen.getByText(/Stale: newly posted lines may be missing/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show missing lines" }));
  expect(show).toHaveBeenCalledOnce();
  const details = screen
    .getByText("Sportsbook coverage & data gaps")
    .closest("details");
  if (!details) throw new Error("Missing details");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const table = screen.getByRole("table", { name: "Sportsbook line coverage" });
  const row = within(table).getByRole("row", { name: /FanDuel/ });
  expect(
    within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["0/3", "1", "1"]);
  expect(screen.getByText(/Unmatched team at Opponent/)).toBeTruthy();
  expect(
    screen.getByText(/missing source quote may still be posted/),
  ).toBeTruthy();
});
