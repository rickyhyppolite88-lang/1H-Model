import { useEffect, useState } from "react";
import { z } from "zod";
import LabComponents from "./LabComponents";
import LabTable from "./LabTable";
import {
  canonicalLabForecasts,
  gradeLab,
  type LabForecast,
  labMethodIdSchema,
  labMethods,
  labSummary,
} from "./model/lab";
import {
  isAllForecastPaperMethod,
  isPaperLabMethod,
  isRefereeLabMethod,
} from "./model/labVersions";
import { easternTipoff, tipoffState } from "./model/time";
import { hasUnitStake, labUnitPlay } from "./model/units";
import RefereeResearch from "./RefereeResearch";
import UnitCalendar from "./UnitCalendar";
import { useLabRecords } from "./useLabRecords";
import { preferencePage, preferenceText, usePreference } from "./usePreference";
import { useRecordDateReset } from "./useRecordDateReset";
import { useUnitLedger } from "./useUnitLedger";

const dateSchema = z.union([
  z.literal("all"),
  z.literal("today"),
  z.iso.date(),
]);
const show = (value: number | null, suffix = "") =>
  value === null ? "—" : `${value.toFixed(2)}${suffix}`;

export default function Lab({ recordOnly = false }: { recordOnly?: boolean }) {
  const {
    ledger: unitLedger,
    plays: calendarPlays,
    error: unitError,
  } = useUnitLedger();
  const [chosenMethod, setMethod] = usePreference(
    "lab.method.v5",
    labMethodIdSchema,
    "market-paper-v3",
  );
  const method =
    recordOnly && chosenMethod === "bonus-exposure-v1"
      ? "enhanced-baseline-v2"
      : chosenMethod;
  const [dateChoice, setDate] = usePreference(
    recordOnly ? "lab.recordDate" : "lab.date",
    dateSchema,
    recordOnly ? "all" : "today",
  );
  const [query, setQuery] = usePreference("lab.search", preferenceText, "");
  const [page, setPage] = usePreference("lab.page", preferencePage, 0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = easternTipoff(new Date(now).toISOString()).date;
  const date = dateChoice === "today" ? today : dateChoice;
  function selectRecordDate(value: string) {
    setDate(value);
    setPage(0);
    setQuery("");
  }
  useRecordDateReset(date, selectRecordDate, recordOnly);
  const { index, store, error, retry } = useLabRecords(date);
  const definition =
    labMethods.find((entry) => entry.id === method) ?? labMethods[0];
  const methodStartedAt =
    index?.methodStartedAt?.[method] ??
    store?.forecasts
      .filter((row) => row.methodId === method)
      .map((row) => row.recordedAt)
      .sort()[0];
  const bonus = definition.kind === "bonus";
  const paper = isPaperLabMethod(method);
  const trial = isAllForecastPaperMethod(method);
  const enabled =
    index?.config.methods.find((entry) => entry.id === method)?.enabled ??
    false;
  const forecasts = (store?.forecasts ?? []).filter(
    (row) => row.methodId === method,
  );
  const canonical = canonicalLabForecasts(forecasts, store?.entryPolicy);
  const unitPlays = store
    ? canonical.map((row) => labUnitPlay(row, store, unitLedger))
    : [];
  const unitMap = new Map(unitPlays.map((play) => [play.id, play]));
  const latest = new Map<string, LabForecast>();
  for (const row of forecasts) {
    const old = latest.get(row.gameId);
    if (
      !old ||
      Date.parse(row.recordedAt) > Date.parse(old.recordedAt) ||
      row.version > old.version
    )
      latest.set(row.gameId, row);
  }
  const isFinished = (row: LabForecast) =>
    store?.results.some(
      (result) => result.gameId === row.gameId && result.season === row.season,
    ) ?? false;
  const choices = (
    recordOnly
      ? canonical.filter(
          (row) => isFinished(row) && hasUnitStake(unitMap.get(row.id)),
        )
      : [...latest.values()].filter((row) => {
          const current = index?.games.find(
            (game) => game.gameId === row.gameId,
          );
          return (
            current &&
            !current.firstHalfComplete &&
            tipoffState({ ...current, actualFirstHalfTotal: null }, now) ===
              "upcoming"
          );
        })
  ).filter((row) => date === "all" || row.gameDate === date);
  const rows = choices
    .filter((row) =>
      `${row.awayTeam} ${row.homeTeam}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
    )
    .sort((a, b) => {
      if (!recordOnly) {
        const priority = (row: LabForecast) =>
          row.status === "qualified" ||
          row.status === "control" ||
          row.status === "paper_test"
            ? 0
            : row.status === "watch_only"
              ? 1
              : 2;
        const pickOrder = priority(a) - priority(b);
        if (pickOrder) return pickOrder;
      }
      return (
        b.gameDate.localeCompare(a.gameDate) ||
        a.startsAt.localeCompare(b.startsAt)
      );
    });
  const summaryRows = (
    recordOnly
      ? canonical.filter(
          (row) => isFinished(row) && hasUnitStake(unitMap.get(row.id)),
        )
      : canonical
  ).filter((row) => date === "all" || row.gameDate === date);
  const summary =
    store && (!recordOnly || unitLedger)
      ? labSummary(summaryRows, store)
      : null;
  const displayRows = recordOnly
    ? rows
    : rows.filter((row) =>
        ["paper_test", "qualified", "control"].includes(row.status),
      );
  const blockedRows = recordOnly
    ? []
    : rows.filter(
        (row) => !["paper_test", "qualified", "control"].includes(row.status),
      );
  const pages = Math.max(1, Math.ceil(displayRows.length / 25));
  const safePage = Math.min(page, pages - 1);
  const dates = [
    ...new Set([
      today,
      ...(index?.archives.map((entry) => entry.date) ?? []),
      ...(date !== "all" ? [date] : []),
    ]),
  ]
    .sort()
    .reverse();
  return (
    <section
      className={`panel lab-panel${recordOnly ? " lab-record-panel" : ""}`}
    >
      <div className="section-heading">
        <span className="step">LAB</span>
        <div>
          <h2>{recordOnly ? "Lab prediction record" : "The Lab"}</h2>
          <p>
            V3/V4 test usable pregame forecasts at 1u paper each. These are
            research trials, not qualified bets. Confidence is unvalidated.
          </p>
        </div>
      </div>
      <fieldset className="lab-version-tabs" aria-label="Lab versions">
        {[
          ["market-paper-v3", "Lab v3", "1u paper trial"],
          ["referee-paper-v4", "Lab v4", "Referee paper trial"],
          ["enhanced-baseline-v2", "Lab v2", "Venue & fouls"],
        ].map(([id, title, description]) => (
          <button
            type="button"
            key={id}
            aria-pressed={method === id}
            onClick={() => {
              setMethod(labMethodIdSchema.parse(id));
              setPage(0);
            }}
          >
            <strong>{title}</strong>
            <small>{description}</small>
          </button>
        ))}
      </fieldset>
      <div className="lab-controls">
        <label>
          {recordOnly ? "Lab daily breakdown (ET)" : "Lab game date (ET)"}
          <select
            value={dateChoice}
            onChange={(event) => {
              setDate(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All dates</option>
            <option value="today">Today · {today}</option>
            {dates
              .filter((value) => value !== today)
              .map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
          </select>
        </label>
        <label>
          Search Lab matchups
          <input
            value={query}
            placeholder="Team name…"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>

      {isRefereeLabMethod(method) && <RefereeResearch />}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button type="button" className="text-button" onClick={retry}>
            Retry Lab
          </button>
        </div>
      )}
      {!index && !error && <p className="empty-state">Loading the Lab…</p>}
      {index && (
        <p className="inline-note">
          {methodStartedAt ? (
            <>
              This version began {easternTipoff(methodStartedAt).date} at{" "}
              {easternTipoff(methodStartedAt).time} ET.
            </>
          ) : (
            "This version is awaiting its first pregame capture."
          )}{" "}
          Earlier games are not backfilled into this prospective record. Last
          published {easternTipoff(index.updatedAt).time} ET.
        </p>
      )}
      <div className={recordOnly ? "record-dashboard" : undefined}>
        {recordOnly && !bonus && (
          <UnitCalendar
            label={
              paper ? (isRefereeLabMethod(method) ? "Lab v4" : "Lab v3") : "Lab"
            }
            paper={paper}
            combined={paper}
            plays={(calendarPlays ?? []).filter(
              (play) =>
                play.source === "lab" &&
                hasUnitStake(play) &&
                play.method === method &&
                play.actual !== null,
            )}
            date={date}
            available={Boolean(calendarPlays && unitLedger)}
            error={unitError}
            onSelectDate={selectRecordDate}
          />
        )}
        {summary && (
          <details className="lab-performance" open={recordOnly}>
            <summary>
              {recordOnly
                ? "Finished Lab record"
                : "Research performance & comparison"}
            </summary>
            <section
              className="record-overview"
              aria-label="Lab record summary"
            >
              <div className="record-overview-top">
                <div>
                  <h3>
                    {recordOnly
                      ? "Finished Lab results"
                      : "Research performance"}
                  </h3>
                  <p>
                    {date === "all" ? "All saved dates" : `${date} · ET`} ·{" "}
                    {definition.name}
                  </p>
                </div>
              </div>
              <div className="audit-metrics">
                <div>
                  <span>
                    {bonus ? "Measured first halves" : "Wins / losses / pushes"}
                  </span>
                  <strong>
                    {bonus
                      ? summary.measured
                      : `${summary.wins} / ${summary.losses} / ${summary.pushes}`}
                  </strong>
                </div>
                <div>
                  <span>
                    {bonus ? "Bonus timing MAE" : "Observed hit rate"}
                  </span>
                  <strong>
                    {bonus
                      ? show(summary.bonusMae, " min")
                      : summary.winRate === null
                        ? "—"
                        : `${(summary.winRate * 100).toFixed(1)}%`}
                  </strong>
                </div>
                <div>
                  <span>
                    {bonus
                      ? "League baseline MAE"
                      : recordOnly
                        ? "Staked plays"
                        : trial
                          ? "1u paper trial entries"
                          : "Qualified / control forecasts"}
                  </span>
                  <strong>
                    {bonus
                      ? show(summary.bonusBaselineMae, " min")
                      : recordOnly
                        ? summary.games
                        : `${summary.qualified} / ${summary.games}`}
                  </strong>
                </div>
                <div>
                  <span>
                    {bonus
                      ? "Missing measurement inputs"
                      : recordOnly
                        ? "Results to review"
                        : "Watch-only / data gaps"}
                  </span>
                  <strong>
                    {bonus
                      ? summary.gaps
                      : recordOnly
                        ? summary.pending
                        : `${summary.watchOnly} / ${summary.gaps}`}
                  </strong>
                </div>
              </div>
              {!bonus && (
                <p className="inline-note">
                  Matched baseline on the same saved lines:{" "}
                  {summary.baselineWins}–{summary.baselineLosses}. Point MAE on
                  settled {trial ? "paper trial" : "qualified/control"} games:
                  Lab {show(summary.matchedMae)} · baseline{" "}
                  {show(summary.matchedBaselineMae)}. Watch-only forecasts do
                  not enter this win rate; pushes are excluded. All projected
                  games MAE: {show(summary.mae)}.
                </p>
              )}
              <p className="inline-note">
                These samples are experimental and do not change the Actual
                record.{" "}
                {recordOnly
                  ? "Only completed first halves with a recorded or replayed stake appear below."
                  : trial
                    ? "Every usable pregame forecast receives 1u paper, including estimates below break-even. The latest usable pre-tip snapshot counts once; the earlier return filter is not used. Missing inputs receive no stake."
                    : "The table shows the latest saved pregame observations. Future records freeze the last pre-tip decision; earlier games keep their original entry. Watch-only decisions remain research and receive no stake."}
              </p>
            </section>
          </details>
        )}
      </div>
      {store && (!recordOnly || unitLedger) ? (
        <>
          {method === "enhanced-baseline-v2" && (
            <LabComponents forecasts={summaryRows} store={store} />
          )}
          {method === "enhanced-baseline-v2" && summary && (
            <details className="lab-calibration">
              <summary>Free-throw & foul research results</summary>
              <p>
                {summary.foulSamples} completed observations with reconciled
                measurements. Combined FT-attempt MAE: {show(summary.ftaMae)} ·
                logged-foul MAE: {show(summary.foulMae)} · 7+ logged-foul
                probability Brier score: {show(summary.foulBrier)} (lower is
                better).
              </p>
              <p>
                These measure the original saved Lab observations, including
                watch-only forecasts. Foul probabilities and 80% count ranges
                remain uncalibrated research estimates, separate from betting
                hit rates.
              </p>
            </details>
          )}
          <h3>
            {recordOnly
              ? "Finished Lab staked plays"
              : trial
                ? "Today’s paper plays"
                : "Upcoming research plays"}
          </h3>
          <LabTable
            rows={displayRows.slice(safePage * 25, (safePage + 1) * 25)}
            store={store}
            bonus={bonus}
            unitPlays={recordOnly ? unitMap : undefined}
          />
          <div className="prediction-pagination">
            <span>
              {displayRows.length} {recordOnly ? "finished" : "upcoming"}{" "}
              research plays
            </span>
            <div className="button-group">
              <button
                type="button"
                className="secondary-button"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={safePage >= pages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </button>
            </div>
          </div>
          {blockedRows.length > 0 && (
            <details className="lab-blocked">
              <summary>
                {blockedRows.length} games waiting for inputs or on watch
              </summary>
              <ul>
                {blockedRows.map((row) => (
                  <li key={row.id}>
                    <strong>
                      {row.awayTeam} at {row.homeTeam}
                    </strong>
                    <span>{row.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {recordOnly && !rows.length && (
            <p className="inline-note">
              No finished staked plays have been recorded for this Lab method
              and date yet. Upcoming forecasts are in The Lab.
            </p>
          )}
          {!bonus && (
            <details className="lab-calibration">
              <summary>Confidence check</summary>
              <p>
                {paper
                  ? "V3/V4 confidence is a fitted research estimate whose calibration has not been validated."
                  : "Earlier-version confidence is an uncalibrated ranking, not a fitted probability."}{" "}
                These observed outcomes cannot be read as the chance that the
                next forecast wins.
              </p>
              <div className="table-wrap">
                <table aria-label="Lab confidence results">
                  <thead>
                    <tr>
                      <th scope="col">Confidence %</th>
                      <th scope="col">Wins</th>
                      <th scope="col">Losses</th>
                      <th scope="col">Observed hit rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 25, 50, 75].map((low) => {
                      const band = summaryRows.filter(
                        (row) =>
                          row.signalStrength !== null &&
                          row.signalStrength >= low &&
                          (low === 75
                            ? row.signalStrength <= 100
                            : row.signalStrength < low + 25) &&
                          ["qualified", "control", "paper_test"].includes(
                            row.status,
                          ),
                      );
                      const grades = band.map((row) => gradeLab(row, store));
                      const w = grades.filter(
                        (grade) => grade.grade === "Win",
                      ).length;
                      const l = grades.filter(
                        (grade) => grade.grade === "Loss",
                      ).length;
                      return (
                        <tr key={low}>
                          <th scope="row">
                            {low}–{low === 75 ? "100" : `<${low + 25}`}
                          </th>
                          <td>{w}</td>
                          <td>{l}</td>
                          <td>
                            {w + l
                              ? `${((100 * w) / (w + l)).toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      ) : index && !error ? (
        <p className="empty-state">Loading the selected Lab history…</p>
      ) : null}
      <details
        className="lab-method-card"
        aria-label="Research method description"
      >
        <summary className="lab-method-heading">
          <h3>{definition.name}</h3>
          <span>
            {index
              ? enabled
                ? "Collecting"
                : "Collection paused"
              : "Loading status…"}
          </span>
          <small>Method details ▾</small>
        </summary>
        <p>{definition.description}</p>
        <p>
          <strong>Method:</strong> {definition.formula}
        </p>
        <p>{definition.limits}</p>
      </details>
      <details className="lab-version-control">
        <summary>Earlier trials</summary>
        <label>
          Lab version
          <select
            value={method}
            onChange={(event) => {
              setMethod(labMethodIdSchema.parse(event.target.value));
              setPage(0);
            }}
          >
            {labMethods
              .filter((entry) => !recordOnly || entry.kind !== "bonus")
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {isAllForecastPaperMethod(entry.id) ||
                  entry.id === "enhanced-baseline-v2"
                    ? ""
                    : " (previous experiment)"}
                </option>
              ))}
          </select>
        </label>
      </details>
    </section>
  );
}
