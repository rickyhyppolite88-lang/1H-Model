import { useState } from "react";
import { marketStatus, sportsbookNames } from "./model/marketCoverage";
import type { PredictionFeed, PredictionRow } from "./model/predictions";
import { easternTipoff } from "./model/time";

export default function MarketCoverage({
  feed,
  rows,
  date,
  book,
  now,
  onShowGaps,
}: {
  feed: PredictionFeed;
  rows: PredictionRow[];
  date: string;
  book: string;
  now: number;
  onShowGaps: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const check = feed.marketChecks?.find((entry) => entry.date === date);
  const checkedAt = check?.checkedAt ?? feed.marketCapturedAt;
  const age = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000));
  const isToday = easternTipoff(new Date(now).toISOString()).date === date;
  const stale = isToday && age > 45;
  const hasLine = (row: PredictionRow, sportsbook: string) =>
    marketStatus(row, sportsbook) === "available" &&
    row.markets.some(
      (market) =>
        market.sportsbook === sportsbook && market.latestLine !== null,
    );
  const captured = rows.filter((row) => hasLine(row, book)).length;
  const elsewhere = rows.filter(
    (row) =>
      !hasLine(row, book) &&
      row.markets.some((market) => hasLine(row, market.sportsbook)),
  ).length;
  const unmatched = (feed.unmatchedMarkets ?? []).filter(
    (row) => row.source === check?.source,
  );
  const names = [
    ...new Set([
      book,
      ...rows.flatMap((row) => row.markets.map((market) => market.sportsbook)),
      ...(check?.books.map((entry) => entry.sportsbook) ?? []),
    ]),
  ].sort();
  return (
    <aside
      className={`market-coverage${stale ? " is-stale" : ""}`}
      aria-label="Market data coverage"
    >
      <div className="market-coverage-summary">
        <div>
          <strong>Data coverage · {sportsbookNames[book] ?? book}</strong>
          <p>
            {captured}/{rows.length} lines captured · {elsewhere} missing here
            with lines at other books ·{" "}
            {rows.filter((row) => row.projectedFirstHalfTotal === null).length}{" "}
            projection gaps
          </p>
        </div>
        <button type="button" className="text-button" onClick={onShowGaps}>
          Show missing lines
        </button>
      </div>
      <p className="market-check-time">
        {check ? "Source checked" : "Last feed capture"}{" "}
        <time dateTime={checkedAt}>
          {new Date(checkedAt).toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          ET
        </time>{" "}
        · {isToday ? `${age} min ago` : "Archived snapshot"}
        {stale ? " · Stale: newly posted lines may be missing" : ""}
      </p>
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>Sportsbook coverage & data gaps</summary>
        {expanded && (
          <>
            <p>
              Counts cover the entire selected date. A missing source quote may
              still be posted at the sportsbook. Regular discovery targets 30
              minutes while games are upcoming; closer to tipoff, checks are at
              least 15 minutes apart. Scheduled jobs can run late.
            </p>
            <div className="table-wrap">
              <table aria-label="Sportsbook line coverage">
                <thead>
                  <tr>
                    <th scope="col">Sportsbook</th>
                    <th scope="col">Captured / games</th>
                    <th scope="col">Source lines</th>
                    <th scope="col">Source lines unmatched</th>
                  </tr>
                </thead>
                <tbody>
                  {names.map((name) => {
                    const source = check?.books.find(
                      (entry) => entry.sportsbook === name,
                    );
                    return (
                      <tr key={name}>
                        <th scope="row">{sportsbookNames[name] ?? name}</th>
                        <td>
                          {rows.filter((row) => hasLine(row, name)).length}/
                          {rows.length}
                        </td>
                        <td>
                          {source?.sourceLines ?? (check ? 0 : "Unknown")}
                        </td>
                        <td>
                          {source?.unmatchedLines ?? (check ? 0 : "Unknown")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {check ? (
              <p>
                {check.matchedGames}/{check.boardGames} source matchups matched
                · {check.unmatchedGames} unmatched.{" "}
                <a href={check.source} target="_blank" rel="noreferrer">
                  Check the source board ↗
                </a>
              </p>
            ) : (
              <p>
                This snapshot predates detailed source reconciliation.
                Missing-line causes are unknown until a new check.
              </p>
            )}
            {unmatched.length > 0 && (
              <ul>
                {unmatched.map((row) => (
                  <li key={row.oddsGameId}>
                    {row.away || "Unknown away team"} at {row.home} ·{" "}
                    {row.booksWithLines?.length ?? "Unknown"} books with source
                    lines. {row.reason}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </details>
    </aside>
  );
}
