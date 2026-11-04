import { useEffect, useMemo, useState } from "react";
import GameTime from "./GameTime";
import { evaluateSeason, ledgerSchema, type SeasonLedger } from "./model/audit";
import { predict } from "./model/predictor";
import {
  preferenceFlag,
  preferenceSportsbook,
  usePreference,
} from "./usePreference";

const format = (value: number | null, digits = 2) =>
  value === null ? "—" : value.toFixed(digits);
const books: Record<string, string> = {
  betmgm: "BetMGM",
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  bet365: "bet365",
  caesars: "Caesars",
  fanatics: "Fanatics",
  hardrock: "Hard Rock",
  bet_rivers_co: "BetRivers",
};

export default function SeasonAudit() {
  const [ledger, setLedger] = useState<SeasonLedger | null>(null);
  const [error, setError] = useState("");
  const [book, setBook] = usePreference(
    "sportsbook",
    preferenceSportsbook,
    "betmgm",
  );
  const [showAll, setShowAll] = usePreference(
    "audit.showAll",
    preferenceFlag,
    false,
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/season-games.json`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Could not load market data: HTTP ${response.status}`,
          );
        return ledgerSchema.parse(await response.json());
      })
      .then(setLedger)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Market data could not be loaded.",
          );
      });
    return () => controller.abort();
  }, []);
  const audit = useMemo(
    () => (ledger ? evaluateSeason(ledger, book) : null),
    [ledger, book],
  );
  if (error)
    return (
      <div className="notice error" role="alert">
        {error}
      </div>
    );
  if (!ledger || !audit)
    return (
      <div className="empty-state">Loading first-half lines and results…</div>
    );
  const availableBooks = [
    ...new Set([
      book,
      ...ledger.games.flatMap((game) => game.quotes.map((q) => q.sportsbook)),
    ]),
  ].sort();
  const games = ledger.games.filter(
    (game) =>
      game.quotes.some((q) => q.sportsbook === book) &&
      (showAll || game.firstHalfComplete),
  );
  const rows = new Map(audit.rows.map((row) => [row.game.id, row]));
  return (
    <section className="panel audit-panel">
      <div className="section-heading">
        <span className="step">1H</span>
        <div>
          <h2>This season, against the line.</h2>
          <p>
            First-half totals and ESPN period results · {ledger.season} ·
            captured{" "}
            {new Date(ledger.capturedAt).toLocaleString("en-US", {
              timeZone: "America/New_York",
            })}{" "}
            ET
          </p>
        </div>
      </div>
      <div className="notice">
        Regular-season outputs are research leans. The inherited tournament
        confidence labels are disabled. Replays use the default 8-game prior and
        35% league regression.{" "}
        {audit.sample < 30
          ? `${audit.sample} comparable halves is below the 30-game collection threshold for a walk-forward review.`
          : "The collection threshold has been reached; a separate walk-forward review is still required before changing coefficients."}
      </div>
      <div className="audit-metrics">
        <div>
          <span>Comparable first halves</span>
          <strong>
            {audit.sample}
            <small> / {audit.completedHalves} completed</small>
          </strong>
        </div>
        <div>
          <span>Model error · MAE</span>
          <strong>
            {format(audit.modelMae)}
            <small> points</small>
          </strong>
        </div>
        <div>
          <span>{books[book] ?? book} opener · MAE</span>
          <strong>
            {format(audit.marketMae)}
            <small> points</small>
          </strong>
        </div>
        <div>
          <span>Legacy filter replay</span>
          <strong>
            {audit.legacyWins}–{audit.legacyLosses}
            <small>
              {audit.legacyPushes ? ` · ${audit.legacyPushes} pushes` : " W–L"}
            </small>
          </strong>
        </div>
      </div>
      <p className="audit-context">
        Model bias: <strong>{format(audit.modelBias)} points</strong>{" "}
        (projection minus actual). This is an observed sample statistic, not an
        automatic scoring correction. {audit.prospective} comparable feature
        sets were archived before tipoff; {audit.sample - audit.prospective} are
        explicitly reconstructed from season-debut priors. Injury information
        was not archived, so the legacy filter replay assumes zero injuries.
      </p>
      <div className="data-toolbar">
        <label className="audit-book">
          Benchmark sportsbook
          <select
            aria-label="Benchmark sportsbook"
            value={book}
            onChange={(event) => setBook(event.target.value)}
          >
            {availableBooks.map((name) => (
              <option key={name} value={name}>
                {books[name] ?? name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show completed first halves" : "Show all posted games"}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipoff (ET)</th>
              <th className="matchup-cell">Matchup</th>
              <th>1H opener</th>
              <th>Latest quote*</th>
              <th>Model</th>
              <th>Actual 1H</th>
              <th>Legacy replay</th>
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => {
              const quote = game.quotes.find((q) => q.sportsbook === book);
              const row = rows.get(game.id);
              const frozen = game.featureSnapshot;
              const prospective =
                frozen?.kind === "captured_pregame" &&
                Date.parse(frozen.capturedAt) < Date.parse(game.startsAt);
              const projection =
                row?.projection ??
                (prospective && frozen && quote?.opening
                  ? predict(
                      frozen.away,
                      frozen.home,
                      quote.opening.total,
                      "regular",
                      0,
                    ).projectedTotal
                  : null);
              const actual =
                game.firstHalfComplete &&
                game.away.firstHalfPoints !== null &&
                game.home.firstHalfPoints !== null
                  ? game.away.firstHalfPoints + game.home.firstHalfPoints
                  : null;
              return (
                <tr key={game.id}>
                  <td>
                    <GameTime startsAt={game.startsAt} />
                  </td>
                  <td className="matchup-cell">
                    <strong>
                      {game.away.name} / {game.home.name}
                    </strong>
                    <small>{game.status}</small>
                    <small>
                      {frozen?.kind === "reconstructed_season_debut"
                        ? "Reconstructed season debut"
                        : prospective
                          ? "Features captured before tipoff"
                          : "No eligible pregame feature archive"}
                    </small>
                  </td>
                  <td>{format(quote?.opening?.total ?? null, 1)}</td>
                  <td>{format(quote?.latest?.total ?? null, 1)}</td>
                  <td>{format(projection)}</td>
                  <td>
                    {actual ?? "Not ended"}
                    {actual !== null && (
                      <small>
                        {game.away.firstHalfPoints} +{" "}
                        {game.home.firstHalfPoints}
                      </small>
                    )}
                  </td>
                  <td>
                    {row
                      ? `${row.legacyPick} · ${row.legacyGrade}`
                      : "Not graded"}
                  </td>
                  <td>
                    <a href={quote?.source} target="_blank" rel="noreferrer">
                      Odds ↗
                    </a>
                    <br />
                    <a href={game.boxScoreUrl} target="_blank" rel="noreferrer">
                      Box score ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="data-notes">
        <p>
          * Latest displayed quote is{" "}
          <strong>not a verified closing line</strong>. The public source
          supplies no quote timestamps. All comparisons use the selected book’s
          opener; there is no fallback to a more favorable book. Scores are
          first-half points, never full-game totals. A finished first half can
          be graded while its game continues.
        </p>
        <p>
          {audit.excluded.length} completed halves excluded from this book’s
          comparison because of missing odds or eligible features.{" "}
          {ledger.unmatchedOdds.length} odds-board games could not be uniquely
          joined to ESPN; they are not silently assigned to another game. Raw
          data and quote provenance are available in the{" "}
          <a
            href={`${import.meta.env.BASE_URL}data/season-games.json`}
            target="_blank"
            rel="noreferrer"
          >
            season ledger ↗
          </a>
          .
        </p>
      </div>
    </section>
  );
}
