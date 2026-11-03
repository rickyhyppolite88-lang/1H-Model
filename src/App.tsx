import {
  type ChangeEvent,
  cloneElement,
  type ReactElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { z } from "zod";
import { type Phase, predict } from "./model/predictor";
import {
  completeMetrics,
  datasetSchema,
  type SeasonDataset,
} from "./model/schema";
import { assertSnapshots, blendTeam, defaultBlend } from "./model/seasons";
import PredictionRecord from "./PredictionRecord";
import Predictions from "./Predictions";
import SeasonAudit from "./SeasonAudit";
import TeamEvaluation from "./TeamEvaluation";

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

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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
  const [datasets, setDatasets] = useState<{
    prior: SeasonDataset;
    current: SeasonDataset;
  } | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [tab, setTab] = useState("predictions");
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [line, setLine] = useState("");
  const [date, setDate] = useState(today);
  const [phase, setPhase] = useState<Phase>("regular");
  const [injuries, setInjuries] = useState(0);
  const [settings, setSettings] = useState(defaultBlend);
  const [search, setSearch] = useState("");
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
  const aId = teams.find(
    (team) => team.name.toLowerCase() === teamA.trim().toLowerCase(),
  )?.id;
  const bId = teams.find(
    (team) => team.name.toLowerCase() === teamB.trim().toLowerCase(),
  )?.id;
  const analysis = useMemo(() => {
    if (!datasets || !aId || !bId || line === "" || !date) return null;
    try {
      const a = blendTeam(
        aId,
        datasets.prior,
        datasets.current,
        settings,
        date,
      );
      const b = blendTeam(
        bId,
        datasets.prior,
        datasets.current,
        settings,
        date,
      );
      return {
        a,
        b,
        result: predict(a, b, Number(line), phase, injuries),
        error: "",
      };
    } catch (error) {
      return {
        a: null,
        b: null,
        result: null,
        error: error instanceof Error ? error.message : "Check model inputs.",
      };
    }
  }, [datasets, aId, bId, line, date, settings, phase, injuries]);

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

  function saveAnalysis() {
    if (!analysis?.result || !analysis.a || !analysis.b || !datasets) return;
    const row: SavedAnalysis = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      teamA: analysis.a.name,
      teamB: analysis.b.name,
      date,
      line: Number(line),
      projection: analysis.result.projectedTotal,
      pick: analysis.result.pick,
      tier: analysis.result.tier,
      priorAsOf: datasets.prior.asOf,
      currentAsOf: datasets.current.asOf,
      phase,
      priorEquivalentGames: settings.priorEquivalentGames,
      leagueRegression: settings.leagueRegression,
      actualTotal: null,
      purpose: phase === "regular" ? "research" : "legacy",
    };
    if (persist([row, ...saved].slice(0, 500)))
      setNotice("Analysis saved in this browser. Find it in the tracker.");
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
      setTeamA("");
      setTeamB("");
      if (date < next.current.asOf) setDate(next.current.asOf);
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
  const result = analysis?.result;
  const staleDays = datasets
    ? Math.floor(
        (Date.parse(`${date}T12:00:00Z`) -
          Date.parse(`${datasets.current.asOf}T12:00:00Z`)) /
          86_400_000,
      )
    : 0;

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
          <span className="status-dot" />
          SEASON BRIDGE v1
          <a
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
            <div className="eyebrow">A NEW SEASON. A MEASURED START.</div>
            <h1>
              The first half,
              <br />
              <em>in perspective.</em>
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
          {[
            ["predictions", "Today’s lines"],
            ["record", "Prediction record"],
            ["matchup", "Matchup lab"],
            ["audit", "Season lines & audit"],
            ["evaluation", "Team comparison"],
            ["data", "Season data"],
            ["tracker", "Pick tracker"],
            ["method", "Method & rules"],
          ].map(([value, label]) => (
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
        {tab === "evaluation" && <TeamEvaluation />}
        {datasets && tab === "matchup" && (
          <>
            {staleDays > 2 && (
              <div className="notice">
                The current snapshot is {staleDays} days older than this
                matchup. Refresh the data before using the projection.
              </div>
            )}
            <div className="lab-grid">
              <section className="panel matchup-panel">
                <div className="section-heading">
                  <span className="step">01</span>
                  <div>
                    <h2>Set the matchup</h2>
                    <p>Use the first-half line, not the full-game total.</p>
                  </div>
                </div>
                <datalist id="teams">
                  {teams.map((team) => (
                    <option key={team.id} value={team.name} />
                  ))}
                </datalist>
                <div className="team-fields">
                  <Field label="Team A">
                    <input
                      list="teams"
                      placeholder="Search a team"
                      value={teamA}
                      onChange={(event) => setTeamA(event.target.value)}
                    />
                  </Field>
                  <span className="versus">vs</span>
                  <Field label="Team B">
                    <input
                      list="teams"
                      placeholder="Search a team"
                      value={teamB}
                      onChange={(event) => setTeamB(event.target.value)}
                    />
                  </Field>
                </div>
                {((teamA && !aId) || (teamB && !bId)) && (
                  <p className="inline-note">
                    Choose an exact team name from the list.
                  </p>
                )}
                <div className="form-grid">
                  <Field label="First-half O/U line">
                    <input
                      type="number"
                      min="1"
                      max="150"
                      step="0.5"
                      placeholder="e.g. 68.5"
                      value={line}
                      onChange={(event) => setLine(event.target.value)}
                    />
                  </Field>
                  <Field label="Matchup date">
                    <input
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </Field>
                  <Field label="Game context">
                    <select
                      value={phase}
                      onChange={(event) =>
                        setPhase(event.target.value as Phase)
                      }
                    >
                      <option value="regular">Regular season</option>
                      <option value="tournament">NCAA tournament</option>
                    </select>
                  </Field>
                  <Field
                    label="Combined reported injuries"
                    hint="Manual input; injuries are not fetched."
                  >
                    <input
                      type="number"
                      min="0"
                      max="40"
                      step="1"
                      value={injuries}
                      onChange={(event) =>
                        setInjuries(Number(event.target.value))
                      }
                    />
                  </Field>
                </div>
                <details className="blend-controls">
                  <summary>
                    Season weighting <span>Adjust the prior</span>
                  </summary>
                  <div className="form-grid">
                    <Field
                      label="Prior strength (equivalent games)"
                      hint="8 games = equal weights after 8 new games."
                    >
                      <input
                        type="number"
                        min="1"
                        max="40"
                        value={settings.priorEquivalentGames}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            priorEquivalentGames: Number(event.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Regression to prior league average"
                      hint="Limits dependence on last year's roster."
                    >
                      <select
                        value={settings.leagueRegression}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            leagueRegression: Number(event.target.value),
                          })
                        }
                      >
                        {[0, 0.2, 0.35, 0.5, 0.75, 1].map((value) => (
                          <option key={value} value={value}>
                            {percent(value)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <p className="inline-note">
                    These are transparent starting settings, not fitted
                    parameters. Returning players and transfers are not yet
                    measured.
                  </p>
                </details>
                <div className="panel-footnote">
                  <span>↳</span> Both teams use their own completed-game count.
                  Current schedule strength is never copied from last season.
                </div>
              </section>

              <section
                className={`projection-panel ${result?.pick === "NO BET" ? "filtered-result" : ""}`}
                aria-live="polite"
              >
                <div className="projection-top">
                  <span className="eyebrow">FIRST-HALF PROJECTION</span>
                  <span className="small-badge">v6.1 rebuild</span>
                </div>
                {analysis?.error ? (
                  <div className="result-placeholder">
                    <span>Check the inputs</span>
                    <p role="alert">{analysis.error}</p>
                  </div>
                ) : result ? (
                  <>
                    <div className="projected-number">
                      {number(result.projectedTotal)}
                      <span>points</span>
                    </div>
                    <div className="projection-comparison">
                      <div>
                        <span>Market line</span>
                        <strong>{number(Number(line))}</strong>
                      </div>
                      <div>
                        <span>Model lean</span>
                        <strong>{result.modelLean}</strong>
                      </div>
                      <div>
                        <span>Model edge</span>
                        <strong>{number(result.edge, 2)}</strong>
                      </div>
                    </div>
                    <div className="decision">
                      <span className="decision-label">
                        {result.mode === "research"
                          ? "RESEARCH LEAN"
                          : "SAVED TOURNAMENT RULE"}
                      </span>
                      <div>
                        <strong>{result.pick}</strong>
                        <span className="small-badge">{result.tier}</span>
                      </div>
                    </div>
                    <ul className="reason-list">
                      {result.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <div className="confidence-note">
                      {result.mode === "research"
                        ? "Regular-season probability: "
                        : "Historical rule label: "}
                      <strong>
                        {result.confidenceLabel ??
                          (result.mode === "research"
                            ? "not calibrated"
                            : "not recorded")}
                      </strong>
                      {!result.confidenceLabel &&
                        result.confidenceBoost > 0 && (
                          <span>
                            {" "}
                            · recorded boost +{result.confidenceBoost}
                          </span>
                        )}
                      <small>
                        A saved heuristic label, not a calibrated win
                        probability. Regular-season accuracy has not been
                        established.
                      </small>
                    </div>
                    <button
                      className="save-button"
                      type="button"
                      onClick={saveAnalysis}
                    >
                      Save analysis <span>↗</span>
                    </button>
                  </>
                ) : (
                  <div className="result-placeholder">
                    <div className="court-symbol">
                      <span />
                    </div>
                    <h2>Every number has a story.</h2>
                    <p>
                      Choose two teams and enter a first-half line to see the
                      projection and its rule checks.
                    </p>
                  </div>
                )}
                <div className="projection-bottom">
                  0.6 × scoring baseline + 0.4 × pace estimate
                  {phase === "tournament"
                    ? " − 4 tournament points"
                    : " · no tournament suppression"}
                </div>
              </section>
            </div>
            {analysis?.a && analysis.b && result && (
              <section className="panel blend-panel">
                <div className="section-heading">
                  <span className="step">02</span>
                  <div>
                    <h2>What went into the number</h2>
                    <p>
                      Blended team stats, with the season weights left visible.
                    </p>
                  </div>
                </div>
                <div className="team-breakdowns">
                  {[analysis.a, analysis.b].map((team) => (
                    <div key={team.id} className="team-breakdown">
                      <div className="team-breakdown-title">
                        <h3>{team.name}</h3>
                        <span>{team.currentGames} new-season games</span>
                      </div>
                      <div className="weight-bar">
                        <span
                          style={{ width: percent(1 - team.currentWeight) }}
                        />
                        <span style={{ width: percent(team.currentWeight) }} />
                      </div>
                      <div className="weight-legend">
                        <span>Prior {percent(1 - team.currentWeight)}</span>
                        <span>Current {percent(team.currentWeight)}</span>
                      </div>
                      <div className="metric-row">
                        <div>
                          <span>1H points</span>
                          <strong>{number(team.firstHalfPoints)}</strong>
                        </div>
                        <div>
                          <span>Pace</span>
                          <strong>{number(team.pace)}</strong>
                        </div>
                        <div>
                          <span>Offense / poss.</span>
                          <strong>{number(team.offensiveEfficiency, 3)}</strong>
                        </div>
                        <div>
                          <span>Defense / poss.</span>
                          <strong>{number(team.defensiveEfficiency, 3)}</strong>
                        </div>
                      </div>
                      {team.notes.map((note) => (
                        <p className="inline-note" key={note}>
                          {note}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="calculation-strip">
                  <span>
                    Scoring sum <strong>{number(result.simpleTotal)}</strong>
                  </span>
                  <span>
                    Pace component{" "}
                    <strong>{number(result.paceAdjustedTotal)}</strong>
                  </span>
                  <span>
                    Tournament adjustment <strong>−{result.suppression}</strong>
                  </span>
                  <span>
                    Projection <strong>{number(result.projectedTotal)}</strong>
                  </span>
                </div>
              </section>
            )}
            <div className="method-callout">
              <span className="eyebrow">TRANSPARENT BY DESIGN</span>
              <p>
                The original source was unavailable. This rebuild preserves the
                documented v6.1 filters and adds an explicit season blend and a
                reconstructed pace formula.
              </p>
              <button type="button" onClick={() => setTab("method")}>
                Read the method ↗
              </button>
            </div>
          </>
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
                  Build a matchup in the lab, then save its projection here.
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setTab("matchup")}
                >
                  Go to matchup lab
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
