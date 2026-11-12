import { useEffect, useRef, useState } from "react";
import GameTime from "./GameTime";
import {
  type RecordIndex,
  type RecordStore,
  recordIndexSchema,
  recordStoreSchema,
} from "./model/predictionRecord";
import {
  finishedRecordStore,
  finishedRecordSummary,
  mergeRecordStores,
} from "./model/recordViews";
import { actualUnitPlay, hasUnitStake } from "./model/units";
import RecordTable from "./RecordTable";
import UnitCalendar from "./UnitCalendar";
import {
  preferencePage,
  preferenceRecordDate,
  preferenceText,
  usePreference,
} from "./usePreference";
import { useRecordDateReset } from "./useRecordDateReset";
import { useUnitLedger } from "./useUnitLedger";

const rate = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;

export default function PredictionRecord() {
  const {
    ledger: unitLedger,
    plays: calendarPlays,
    error: unitError,
  } = useUnitLedger("draftkings");
  const [index, setIndex] = useState<RecordIndex | null>(null);
  const [indexError, setIndexError] = useState("");
  const [date, setDate] = usePreference(
    "record.date",
    preferenceRecordDate,
    "all",
  );
  const [query, setQuery] = usePreference("record.search", preferenceText, "");
  const [page, setPage] = usePreference("record.page", preferencePage, 0);
  function selectDate(value: string) {
    setDate(value);
    setQuery("");
    setPage(0);
  }
  useRecordDateReset(date, selectDate);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    store: RecordStore | null;
    error: string;
  } | null>(null);
  const cache = useRef(
    new Map<string, { revision: string; store: RecordStore }>(),
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/prediction-record-draftkings-index.json`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw new Error("The prediction record could not be loaded.");
        const data = recordIndexSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setIndex(data);
          setIndexError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setIndexError(
            "The prediction record could not be refreshed. Try reloading the page.",
          );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  const archive = index?.archives.find((entry) => entry.date === date);
  const loadKey = `${index?.updatedAt ?? ""}:${date}:${retry}`;
  useEffect(() => {
    if (!index) return;
    const controller = new AbortController();
    const archives = date === "all" ? index.archives : archive ? [archive] : [];
    const load = async () => {
      try {
        const stores = await Promise.all(
          archives.map(async (entry) => {
            const cached = cache.current.get(entry.jsonPath);
            if (cached?.revision === index.updatedAt) return cached.store;
            const response = await fetch(
              `${import.meta.env.BASE_URL}${entry.jsonPath}`,
              { signal: controller.signal, cache: "no-store" },
            );
            if (!response.ok)
              throw new Error("A saved record could not be loaded.");
            const store = recordStoreSchema.parse(await response.json());
            if (
              store.records.some((record) => record.sportsbook !== "draftkings")
            )
              throw new Error(
                "The DraftKings record contains a different sportsbook",
              );
            if (!controller.signal.aborted)
              cache.current.set(entry.jsonPath, {
                revision: index.updatedAt,
                store,
              });
            return store;
          }),
        );
        const store = mergeRecordStores(stores, index.updatedAt);
        if (!controller.signal.aborted)
          setLoaded({ key: loadKey, store, error: "" });
      } catch {
        if (!controller.signal.aborted)
          setLoaded({
            key: loadKey,
            store: null,
            error:
              "The full record could not load all dates. No partial history is shown.",
          });
      }
    };
    void load();
    return () => controller.abort();
  }, [index, date, archive, loadKey]);

  if (!index)
    return indexError ? (
      <div className="notice error" role="alert">
        {indexError}
      </div>
    ) : (
      <div className="empty-state">Loading the shared prediction record…</div>
    );
  const current = loaded?.key === loadKey ? loaded : null;
  const store = current?.store ?? null;
  const modelRecords = store?.records ?? [];
  const unitPlays = modelRecords
    .filter((record) => index.canonicalIds.includes(record.id))
    .map((record) => actualUnitPlay(record, store?.results ?? [], unitLedger));
  const unitMap = new Map(unitPlays.map((play) => [play.id, play]));
  const scopedStore =
    store && unitLedger
      ? finishedRecordStore({
          ...store,
          records: modelRecords.filter(
            (record) =>
              hasUnitStake(unitMap.get(record.id)) &&
              (date === "all" || record.gameDate === date),
          ),
        })
      : null;
  const summary = scopedStore
    ? finishedRecordSummary(scopedStore, index.canonicalIds)
    : null;
  const rows = (scopedStore?.records ?? [])
    .filter((record) =>
      `${record.prediction.awayTeam} ${record.prediction.homeTeam}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        b.gameDate.localeCompare(a.gameDate) ||
        a.prediction.startsAt.localeCompare(b.prediction.startsAt) ||
        b.version - a.version,
    );
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * 25, (safePage + 1) * 25);

  return (
    <section className="panel prediction-record-panel">
      <div className="section-heading">
        <span className="step">LOG</span>
        <div>
          <h2>DraftKings prediction record</h2>
          <p>
            Hits, misses and pushes against saved DraftKings 1H lines. Older
            dates replay the original frozen projections against archived
            pre-tip DraftKings lines; replay stakes and scores are calculated
            later. Original records remain intact in the archives.
          </p>
        </div>
      </div>
      {indexError && (
        <p className="notice error" role="alert">
          {indexError}
        </p>
      )}
      <div className="record-dashboard">
        <UnitCalendar
          combined
          plays={(calendarPlays ?? []).filter(
            (play) =>
              play.source === "actual" &&
              play.sportsbook === "draftkings" &&
              hasUnitStake(play) &&
              play.actual !== null,
          )}
          date={date}
          onSelectDate={selectDate}
          available={Boolean(unitLedger && calendarPlays)}
          error={unitError}
        />
        <section
          className="record-overview"
          aria-label="Full record summary"
          aria-live="polite"
          aria-busy={!summary && !current?.error}
        >
          <div className="record-overview-top">
            <div>
              <h3>Full prediction record</h3>
              <p>
                {date === "all"
                  ? "All dates · finished first halves"
                  : `${date} · ET · finished first halves`}
              </p>
            </div>
            <label className="record-date-control">
              Daily breakdown (ET)
              <select
                value={date}
                onChange={(event) => selectDate(event.target.value)}
              >
                <option value="all">All dates · full record</option>
                {date !== "all" && !archive && (
                  <option value={date}>{date} · no saved archive</option>
                )}
                {index.archives.map((entry) => (
                  <option key={entry.date} value={entry.date}>
                    {entry.date} · ET
                  </option>
                ))}
              </select>
            </label>
          </div>
          {summary ? (
            <>
              <div className="audit-metrics">
                <div>
                  <span>Wins / losses / pushes</span>
                  <strong>
                    {summary.wins} / {summary.losses} / {summary.pushes}
                  </strong>
                </div>
                <div>
                  <span>Observed win rate</span>
                  <strong>{rate(summary.winRate)}</strong>
                </div>
                <div>
                  <span>Graded staked plays</span>
                  <strong>{summary.counted}</strong>
                </div>
                <div>
                  <span>Finished staked plays</span>
                  <strong>{summary.games}</strong>
                </div>
              </div>
              <p className="inline-note">
                DraftKings only. Recorded entries and labeled historical replays
                use their saved lines and matching odds. Pushes are excluded
                from win rate.{" "}
                {summary.ungraded > 0
                  ? `${summary.ungraded} staked plays await a verified grade.`
                  : ""}
                {summary.review > 0
                  ? ` ${summary.review} results need schedule review.`
                  : ""}
              </p>
            </>
          ) : (
            <p>
              {current?.error
                ? "Record totals are unavailable until the selected records load."
                : "Loading finished results…"}
            </p>
          )}
        </section>
      </div>
      <div className="record-history-heading">
        <h3>
          {date === "all"
            ? "Finished staked plays"
            : `Finished staked plays for ${date}`}
        </h3>
        <span>{date === "all" ? "All saved dates" : "Selected day only"}</span>
      </div>
      <div className="record-history-filters">
        <label>
          Search recorded matchups
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
      {current?.error ? (
        <div className="record-load-error">
          <p className="notice error" role="alert">
            {current.error}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry loading records
          </button>
        </div>
      ) : !scopedStore ? (
        <div className="empty-state">
          {unitError && !unitLedger
            ? "The staked record is unavailable until saved stakes load."
            : "Loading finished staked plays…"}
        </div>
      ) : (
        <>
          <RecordTable
            records={visible}
            results={scopedStore.results}
            canonicalIds={index.canonicalIds}
            unitPlays={unitMap}
            showVersions={false}
            onOpenDay={date === "all" ? selectDate : undefined}
            emptyMessage={
              summary?.games
                ? undefined
                : `No finished staked plays are recorded${date === "all" ? "" : ` for ${date}`} yet. Upcoming games are available in Today’s lines.`
            }
          />
          <div className="prediction-pagination">
            <span>
              {rows.length} finished staked plays in this view ·{" "}
              {date === "all" ? "all dates" : date}
            </span>
            <div className="button-group">
              <button
                className="secondary-button"
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={safePage >= pages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
      <div className="record-extras">
        {summary && (
          <details>
            <summary>Results by saved confidence score</summary>
            <p>
              Official finished results for{" "}
              {date === "all" ? "all dates" : date}; confidence scores are
              research rankings, not win probabilities. These bands use only
              original saved scores; ratings labeled Calculated later remain
              separate.
            </p>
            <div className="table-wrap">
              <table aria-label="Signal results">
                <thead>
                  <tr>
                    <th>Confidence score band (%)</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Pushes</th>
                    <th>Observed win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bands.map((band) => (
                    <tr key={band.label}>
                      <th scope="row">{band.label}</th>
                      <td>{band.wins}</td>
                      <td>{band.losses}</td>
                      <td>{band.pushes}</td>
                      <td>{rate(band.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <details>
          <summary>How records and exclusions work</summary>
          <p>
            Games appear once the first-half result is final. Future entries use
            the verified pre-tip DraftKings snapshot from the final 15 minutes.
            Older replay entries keep the original model projection and use the
            last available archived DraftKings quote observed before tipoff.
            That quote is not guaranteed to be the closing line. Games without
            verified pre-tip DraftKings quotes receive no replay. Completed
            prior Eastern dates may replay a frozen pregame forecast even if its
            official final-window entry was missed; these remain labeled replays
            and receive no backdated recorded stake.
          </p>
        </details>
        <details>
          <summary>Source data and downloads</summary>
          <p>
            The permanent archives retain every forecast, including upcoming
            games and pending picks. Downloads below include those complete
            archives.
          </p>
          <div className="prediction-actions">
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/actual-units-draftkings.csv`}
              download="1h-draftkings-unit-plays.csv"
            >
              All DraftKings unit plays CSV ↓
            </a>
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/prediction-record.xlsx`}
              download="1h-prediction-record.xlsx"
            >
              Complete forecast archive Excel ↓
            </a>
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/prediction-record.csv`}
              download="1h-prediction-record.csv"
            >
              All versions CSV ↓
            </a>
            {archive && (
              <>
                <a
                  className="text-button"
                  href={`${import.meta.env.BASE_URL}${archive.jsonPath}`}
                  download
                >
                  Full dated inputs JSON ↓
                </a>
                {archive.gamesCsvPath && (
                  <a
                    className="text-button"
                    href={`${import.meta.env.BASE_URL}${archive.gamesCsvPath}`}
                    download={`1h-all-games-${archive.date}.csv`}
                  >
                    Selected day: all games CSV ↓
                  </a>
                )}
              </>
            )}
          </div>
        </details>
      </div>
      <p className="record-updated">
        Updated <GameTime startsAt={index.updatedAt} />
      </p>
    </section>
  );
}
