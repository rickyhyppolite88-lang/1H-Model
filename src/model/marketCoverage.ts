import { z } from "zod";

export const gameMarketCoverageSchema = z.object({
  checkedAt: z.iso.datetime(),
  source: z.url(),
  status: z.enum(["matched", "not_matched"]),
  books: z.array(
    z.object({
      sportsbook: z.string(),
      status: z.enum(["available", "no_current_line"]),
    }),
  ),
});

export const marketCheckSchema = z.object({
  date: z.iso.date(),
  checkedAt: z.iso.datetime(),
  source: z.url(),
  boardGames: z.number().int().min(0),
  matchedGames: z.number().int().min(0),
  unmatchedGames: z.number().int().min(0),
  books: z.array(
    z.object({
      sportsbook: z.string(),
      sourceLines: z.number().int().min(0),
      importedLines: z.number().int().min(0),
      unmatchedLines: z.number().int().min(0),
    }),
  ),
});

type CoverageRow = {
  marketCoverage?: z.infer<typeof gameMarketCoverageSchema>;
  markets: { sportsbook: string; latestLine: number | null }[];
};

/** Missing from an aggregator never proves that a sportsbook has not posted. */
export function marketStatus(row: CoverageRow, book: string) {
  if (row.marketCoverage) {
    if (row.marketCoverage.status === "not_matched") return "not_matched";
    return (
      row.marketCoverage.books.find((entry) => entry.sportsbook === book)
        ?.status ?? "not_in_feed"
    );
  }
  return row.markets.some(
    (market) => market.sportsbook === book && market.latestLine !== null,
  )
    ? "available"
    : "not_checked";
}

export function marketStatusLabel(row: CoverageRow, book: string) {
  const status = marketStatus(row, book);
  return {
    available: "Line captured",
    no_current_line: "Source returned no current line",
    not_in_feed: "Book missing from source feed",
    not_matched: "No verified source matchup matched",
    not_checked: "No captured line; source coverage unknown",
  }[status];
}

export const sportsbookNames: Record<string, string> = {
  betmgm: "BetMGM",
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  bet365: "bet365",
  caesars: "Caesars",
  fanatics: "Fanatics",
  hardrock: "Hard Rock",
  bet_rivers_co: "BetRivers",
};
