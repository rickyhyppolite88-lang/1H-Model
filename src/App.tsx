import {
  type ChangeEvent,
  cloneElement,
  type ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import { z } from "zod";
import { useAppLock } from "./AccessGate";
import Lab from "./Lab";
import MobileNavigation from "./MobileNavigation";
import {
  completeMetrics,
  datasetSchema,
  type SeasonDataset,
} from "./model/schema";
import { assertSnapshots, defaultBlend } from "./model/seasons";
import PredictionRecord from "./PredictionRecord";
import Predictions from "./Predictions";
import SeasonAudit from "./SeasonAudit";
import TeamEvaluation from "./TeamEvaluation";
import ThemeToggle from "./ThemeToggle";
import {
  preferenceSection,
  preferenceText,
  resetViewPreferences,
  usePreference,
} from "./usePreference";

const savedSchema = z.object({
  id: z.string(),
  savedAt: z.string(),
  teamA: z.string(),
  teamB: z.string(),
  date: z.string(),
  line: z.number(),
  projection: z.number(),
  pick: z.enum(["OVER", "UNDER", "NO BET"]),
  tier: z.string(),
  priorAsOf: z.string(),
  currentAsOf: z.string(),
  phase: z.enum(["regular", "tournament"]),
  priorEquivalentGames: z.number(),
  leagueRegression: z.number(),
  actualTotal: z.number().min(0).nullable(),
  purpose: z.enum(["research", "legacy"]).default("legacy"),
});
type SavedAnalysis = z.infer<typeof savedSchema>;
const storageKey = "1h-model-analyses-v1";
const number = (value: number, digits = 1) => value.toFixed(digits);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const sections = [
  ["predictions", "Today’s lines"],
  ["record", "Prediction record"],
  ["lab", "Lab"],
  ["audit", "Season lines & audit"],
  ["evaluation", "Team comparison"],
  ["data", "Season data"],
  ["tracker", "Pick tracker"],
  ["method", "Method & rules"],
  ["settings", "Settings & session"],
];

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

function grade(row: SavedAnalysis) {
  if (row.purpose === "research") return "Research";
  if (row.pick === "NO BET") return "Not played";
  if (row.actualTotal === null) return "Pending";
  if (row.actualTotal === row.line) return "Push";
  return row.actualTotal > row.line === (row.pick === "OVER") ? "Win" : "Loss";
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const lockApp = useAppLock();
  const [datasets, setDatasets] = useState<{
    prior: SeasonDataset;
    current: SeasonDataset;
  } | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [tab, setTab] = usePreference(
    "section",
    preferenceSection,
    "predictions",
  );
  const settings = defaultBlend;
  const [search, setSearch] = usePreference("data.search", preferenceText, "");
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      ["prior-season", "current-season"].map(async (name) => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/${name}.json`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(`Could not load ${name}: HTTP ${response.status}`);
        return datasetSchema.parse(await response.json());
      }),
    )
      .then(([prior, current]) => setDatasets({ prior, current }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadingError(
            error instanceof Error
              ? error.message
              : "Unable to load season data.",
          );
      });
    try {
      const text = localStorage.getItem(storageKey);
      if (text) setSaved(z.array(savedSchema).max(500).parse(JSON.parse(text)));
    } catch {
      setNotice(
        "Saved analyses could not be read. You can still use the model.",
      );
    }
    return () => controller.abort();
  }, []);

  const teams = datasets?.current.teams ?? [];
  function persist(rows: SavedAnalysis[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(rows));
      setSaved(rows);
      return true;
    } catch {
      setNotice(
        "This browser could not save the analysis. Export your records to keep a copy.",
      );
      return false;
    }
  }

  async function importSnapshot(
    event: ChangeEvent<HTMLInputElement>,
    kind: "prior" | "current",
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !datasets) return;
    try {
      if (file.size > 3_000_000)
        throw new Error("Snapshot files must be smaller than 3 MB.");
      const imported = datasetSchema.parse(JSON.parse(await file.text()));
      const next = { ...datasets, [kind]: imported };
      assertSnapshots(next.prior, next.current, next.current.asOf);
      setDatasets(next);
      setNotice(
        `${imported.season} snapshot loaded for this session. Use the import script to update the published data.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The snapshot file was invalid.",
      );
    }
  }

  const observedTeams = teams.filter(
    (team) => team.gamesPlayed > 0 && completeMetrics(team),
  ).length;
  const filtered = teams.filter((team) =>
    team.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href={import.meta.env.BASE_URL}>
          <span className="brand-mark">1H</span>
          <span>
            MODEL<span className="wordmark-sub">COLLEGE BASKETBALL</span>
          </span>
        </a>
        <div className="topbar-right">
          <span className="league-badge">CBB · 1H</span>
          <ThemeToggle />
          <button
            className="lock-button"
            type="button"
            onClick={lockApp}
            aria-label="Lock app"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3" />
            </svg>
            <span>Lock</span>
          </button>
          <a
            className="source-link"
            aria-label="View source code"
            href="https://github.com/rickyhyppolite88-lang/1H-Model"
            target="_blank"
            rel="noreferrer"
          >
            Source ↗
          </a>
        </div>
      </header>

      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">COLLEGE BASKETBALL · 2026–27</div>
            <h1>
              First-half totals.
              <br />
              <em>A clearer view.</em>
            </h1>
            <p>
              Last season sets the baseline. This season earns the weight.
              <br className="desktop-break" /> Explore the total, the inputs,
              and the rules behind the lean.
            </p>
          </div>
          <div className="season-summary">
            <span className="eyebrow">SEASON TRANSITION</span>
            <div className="season-years">
              {datasets?.prior.season ?? "2025–26"}
              <span>↗</span>
              {datasets?.current.season ?? "2026–27"}
            </div>
            <div className="summary-line">
              <span>Completed-season baseline</span>
              <strong>{datasets?.prior.teams.length ?? "—"} teams</strong>
            </div>
            <div className="summary-line">
              <span>Current teams with full observations</span>
              <strong>{datasets ? observedTeams : "—"}</strong>
            </div>
            <div className="summary-footer">
              Snapshot through {datasets?.current.asOf ?? "loading…"}
              <span>TeamRankings</span>
            </div>
          </div>
        </div>

        <nav className="tabs" aria-label="Model sections">
          <label className="mobile-section-select">
            View
            <select
              value={tab}
              onChange={(event) => setTab(event.target.value)}
            >
              {sections.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                  {value === "tracker" && saved.length > 0
                    ? ` (${saved.length})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {sections.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? "active" : ""}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => setTab(value)}
            >
              {label}
              {value === "tracker" && saved.length > 0 && (
                <span className="count">{saved.length}</span>
              )}
            </button>
          ))}
        </nav>

        {notice && (
          <output className="notice">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </output>
        )}
        {loadingError && (
          <div className="notice error" role="alert">
            {loadingError}
          </div>
        )}
        {!datasets && !loadingError && (
          <div className="empty-state">Loading dated season statistics…</div>
        )}

        {tab === "predictions" && <Predictions />}
        {tab === "record" && <PredictionRecord />}
        {tab === "lab" && <Lab />}
        {tab === "evaluation" && <TeamEvaluation />}
        {tab === "settings" && (
          <section className="panel settings-panel">
            <div className="section-heading">
              <span className="step">VIEW</span>
              <div>
                <h2>Settings & session</h2>
                <p>Your choices stay on this device.</p>
              </div>
            </div>
            <h3>Remember my view</h3>
            <p>
              The app locks after 30 minutes of inactivity. Refreshing an active
              session keeps you signed in; locking keeps your saved view ready
              for next time.
            </p>
            <p>
              Sportsbook, filters, dates, and record views survive refreshes and
              section changes. Saved views expire after seven days without
              reopening that view.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                resetViewPreferences();
                setNotice(
                  "Saved views reset. Your recorded predictions and saved analyses are preserved.",
                );
              }}
            >
              Reset saved views
            </button>
          </section>
        )}
        {datasets && tab === "data" && (
          <section className="panel data-panel">
            <div className="section-heading">
              <span className="step">DATA</span>
              <div>
                <h2>Two seasons. Separate snapshots.</h2>
                <p>
                  {datasets.prior.season} through {datasets.prior.asOf} ·{" "}
                  {datasets.current.season} through {datasets.current.asOf}
                </p>
              </div>
            </div>
            <div className="data-toolbar">
              <input
                aria-label="Filter teams"
                placeholder="Filter teams…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="button-group">
                <label className="secondary-button">
                  Import prior JSON
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void importSnapshot(event, "prior")}
                  />
                </label>
                <label className="secondary-button">
                  Import current JSON
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void importSnapshot(event, "current")}
                  />
                </label>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Prior games</th>
                    <th>Prior 1H PPG</th>
                    <th>Current games</th>
                    <th>Current 1H PPG</th>
                    <th>Current weight</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((team) => {
                    const old = datasets.prior.teams.find(
                      (prior) => prior.id === team.id,
                    );
                    const weight =
                      team.gamesPlayed > 0 && completeMetrics(team)
                        ? team.gamesPlayed /
                          (team.gamesPlayed + settings.priorEquivalentGames)
                        : 0;
                    return (
                      <tr key={team.id}>
                        <td>{team.name}</td>
                        <td>{old?.gamesPlayed ?? "—"}</td>
                        <td>{old?.firstHalfPoints?.toFixed(1) ?? "—"}</td>
                        <td>{team.gamesPlayed}</td>
                        <td>{team.firstHalfPoints?.toFixed(1) ?? "—"}</td>
                        <td>{percent(weight)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="data-notes">
              <p>
                “—” means no observation, never a zero. Statistics come from the
                season column, not the “Last 3,” “Last 1,” or last-year
                comparison columns.
              </p>
              <div className="button-group">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => download("prior-season.json", datasets.prior)}
                >
                  Export prior snapshot ↓
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    download("current-season.json", datasets.current)
                  }
                >
                  Export current snapshot ↓
                </button>
                <a
                  href={datasets.prior.source.urls.firstHalfPoints}
                  target="_blank"
                  rel="noreferrer"
                >
                  View source ↗
                </a>
              </div>
            </div>
          </section>
        )}

        {tab === "tracker" && (
          <section className="panel tracker-panel">
            <div className="section-heading">
              <span className="step">LOG</span>
              <div>
                <h2>Keep the record honest.</h2>
                <p>
                  Saved in this browser. Each entry freezes its projection,
                  settings, and source dates.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={!saved.length}
                onClick={() => download("1h-model-analyses.json", saved)}
              >
                Export JSON ↓
              </button>
            </div>
            {saved.length === 0 ? (
              <div className="empty-state">
                <h3>No analyses saved yet.</h3>
                <p>
                  Previously saved manual analyses appear here. Open Prediction
                  record for the shared automatic results.
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setTab("record")}
                >
                  Open prediction record
                </button>
              </div>
            ) : (
              <div className="tracker-list">
                {saved.map((row) => (
                  <article key={row.id} className="saved-row">
                    <div>
                      <span className="eyebrow">
                        {row.date} · {row.tier}
                      </span>
                      <h3>
                        {row.teamA} <span>vs</span> {row.teamB}
                      </h3>
                      <p>
                        {row.pick} · line {row.line} · projection{" "}
                        {number(row.projection)}
                        <small>
                          Data through {row.currentAsOf} · {row.phase}
                        </small>
                      </p>
                    </div>
                    <Field label="Actual 1H total">
                      <input
                        type="number"
                        min="0"
                        max="250"
                        step="1"
                        value={row.actualTotal ?? ""}
                        placeholder="Pending"
                        onChange={(event) => {
                          const text = event.target.value;
                          const actualTotal = text === "" ? null : Number(text);
                          if (
                            actualTotal !== null &&
                            (!Number.isFinite(actualTotal) || actualTotal < 0)
                          )
                            return;
                          persist(
                            saved.map((entry) =>
                              entry.id === row.id
                                ? { ...entry, actualTotal }
                                : entry,
                            ),
                          );
                        }}
                      />
                    </Field>
                    <span className={`grade grade-${grade(row).toLowerCase()}`}>
                      {grade(row)}
                    </span>
                    <button
                      className="text-button"
                      type="button"
                      aria-label={`Remove ${row.teamA} vs ${row.teamB}`}
                      onClick={() => {
                        persist(saved.filter((entry) => entry.id !== row.id));
                      }}
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "audit" && <SeasonAudit />}

        {tab === "method" && (
          <section className="panel method-panel">
            <span className="eyebrow">
              MODEL NOTES · RECONSTRUCTED v6.1 + SEASON BRIDGE v1
            </span>
            <h2>Make the assumptions visible.</h2>
            <div className="method-grid">
              <article>
                <h3>01 / Carry the baseline forward</h3>
                <p>
                  Prior team stat = (1 − regression) × last season’s final team
                  stat + regression × last season’s league average. The default
                  league regression is 35%.
                </p>
                <p>
                  Current weight = current completed games ÷ (current completed
                  games + prior equivalent games). The default prior strength is
                  8 games. At 0, 8, and 24 current games, the current season
                  carries 0%, 50%, and 75% of the blend.
                </p>
                <p>
                  Each team gets its own weight. Missing prior teams use the
                  prior league average. Incomplete current metrics retain the
                  prior instead of silently replacing missing observations with
                  zero. Roster and coaching changes still need a measured input.
                </p>
              </article>
              <article>
                <h3>02 / Build the first-half total</h3>
                <p>
                  Scoring component = the two blended first-half scoring
                  averages added together.
                </p>
                <p>
                  Expected pace = mean of team paces. Expected efficiency for
                  each offense = mean of its offensive efficiency and its
                  opponent’s defensive efficiency. Pace component = expected
                  pace × the sum of both expected efficiencies ÷ 2.
                </p>
                <p>
                  Projection = 60% scoring component + 40% pace component. The
                  saved −4-point suppression applies only when NCAA tournament
                  context is selected. The pace formula and regular-season
                  handling are new, uncalibrated reconstruction choices.
                </p>
              </article>
              <article>
                <h3>03 / Apply the saved rules</h3>
                <p>
                  Any OE below 0.96 blocks all picks. PACE OVER requires a pace
                  gap of at least 5, both OE values at least 1.05, and both
                  current schedule ratings positive. It overrides model lean and
                  edge filters, but 3+ combined reported injuries still block
                  OVER.
                </p>
                <p>
                  Otherwise, edge ≥ 8, edge &lt; 1.5, or OVER edge &lt; 2 means
                  NO BET. A line below 68 with a 2–3-point UNDER edge matches
                  LOCK. A 2–3-point UNDER otherwise matches PRIME UNDER.
                </p>
                <p>
                  The old defensive-efficiency exclusion stays removed.
                  Historical 95%, 75%, 70%, and 80–85% labels are shown as saved
                  heuristics; they are not fitted probabilities for this version
                  or season.
                </p>
              </article>
              <article>
                <h3>04 / Validate before recalibrating</h3>
                <p>
                  Snapshots are dated and season-checked. An analysis cannot use
                  a snapshot dated after its matchup date. Do not use the final
                  2025–26 snapshot to backtest an earlier 2025–26 game.
                </p>
                <p>
                  True backtesting needs pregame snapshots, historical
                  first-half lines, injury information known before tipoff, and
                  first-half results. The original 63-game tracker was not
                  recovered, so this app reports no inherited accuracy claim.
                </p>
                <p>
                  The blend strength, league regression, pace formula, and
                  regular-season intercept should be selected using historical
                  walk-forward validation before changing live rules.
                </p>
              </article>
            </div>
          </section>
        )}
      </main>
      <MobileNavigation active={tab} sections={sections} onSelect={setTab} />
      <footer>
        <span>
          <strong>1H MODEL</strong> · Know what is in the number.
        </span>
        <span>
          Public statistics by{" "}
          <a
            href="https://www.teamrankings.com/ncaa-basketball/"
            target="_blank"
            rel="noreferrer"
          >
            TeamRankings ↗
          </a>{" "}
          · Refresh dates shown in app.
        </span>
      </footer>
    </div>
  );
}
