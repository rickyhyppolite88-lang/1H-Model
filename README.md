# 1H Model

College basketball first-half totals, rebuilt from the saved MADNESS v6.1 notes, with a new transition from the completed 2025–26 season into 2026–27.

The original Python repository and 63-game results tracker were not recovered. This is a documented reconstruction, not the original source or a claim to reproduce its historical performance.

## Run locally

Requires Node 22.12+ (Node 24 recommended). Python 3.10+ and `requirements-dev.txt` dependencies are needed for data imports, Excel generation, and Python tests.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

```sh
npm test
npm run check
npm run build
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## Included

- React 19, TypeScript, Vite, Tailwind, Biome, and Vitest.
- Dated public TeamRankings snapshots for 365 teams, with season-end and current-season data kept separate.
- A configurable prior/current blend that increases each team's current-season weight as it plays games.
- The documented v6.1 rule filters and tiers, with separate regular-season and tournament contexts.
- Visible projection components, source dates, data import/export, and a browser-local pick tracker.
- A first-half lines/results audit with book-specific openers, explicit closing-line uncertainty, and frozen pregame features.
- A GitHub Pages build/deploy workflow and daily in-season data refresh. No GCP services or credentials.

## The season bridge

For each of first-half points, pace, offensive efficiency, and defensive efficiency:

```text
prior = (1 - leagueRegression) * finalPriorTeamStat
        + leagueRegression * finalPriorLeagueAverage
currentWeight = currentGames / (currentGames + priorEquivalentGames)
blendedStat = prior * (1 - currentWeight) + currentStat * currentWeight
```

Starting settings are **8 prior equivalent games** and **35% regression to the prior-season league average**. These are explicit, uncalibrated defaults. At 0, 8, and 24 current games, the current season gets 0%, 50%, and 75% of the weight. Each team has its own sample size. Returning-player production, transfers, and coaching changes are not yet measured.

No previous-season schedule-strength rating is carried into this year's PACE OVER check. Missing or incomplete current stats retain the prior. Teams without a complete prior use the prior league average. Missing data is never scored as zero.

See [the model specification](docs/model-specification.md) for formulas, rule priority, uncertainties, and validation requirements.

## Refresh public data

```sh
python scripts/import_teamrankings.py --season 2025-26 --as-of 2026-04-07 --output public/data/prior-season.json
python scripts/import_teamrankings.py --season 2026-27 --as-of 2026-11-02 --output public/data/current-season.json
```

Omit `--as-of` to use today's date. The importer reads six public dated tables, checks the selected date and season-column header, joins stable team links, and rejects partial or mismatched tables. It uses visible ratings rather than `data-sort` values, which can include a sorting offset. No paid/private data or keys are required.

The full prior snapshot is frozen at April 7, 2026. The initial current snapshot is November 2, 2026; only two teams have completed-game observations in that snapshot. The app displays its actual dates and warns on stale data. A source change or failed request fails the refresh rather than publishing invented or partial observations.

The workflow refreshes team data and first-half markets/results at 11:20, 17:20, and 23:20 UTC during November–April. It validates before committing and deploying. A GitHub Actions bot commit does not trigger another workflow run; the same run deploys the refreshed data. New-season rollover is deliberate: update the season identifier and snapshot pair after the current season ends.

Public statistics: [TeamRankings college basketball](https://www.teamrankings.com/ncaa-basketball/). Every JSON snapshot records exact dated source URLs and retrieval time. The stat values use points per possession, not points per 100 possessions. Display precision follows the public source.

## Deploy on GitHub Pages

1. Push this source to `rickyhyppolite88-lang/1H-Model` on `main` using an account with write permission.
2. In **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
3. Let **Validate and deploy 1H Model** finish. The deployment's actual URL appears in the `github-pages` environment.

The expected repository Pages address is `https://rickyhyppolite88-lang.github.io/1H-Model/`, but it is not live until the first deployment succeeds. The workflow sets the repository base path; local development runs at `/`. [Vite's Pages instructions](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub's workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) describe the deployment mechanism.

The matchup lab runs in the browser; the batch job uses the same TypeScript projection function. The pick tracker uses local storage on that browser and does not sync between devices. Export records to retain a copy. Lab injury/line inputs are manual. The prediction page reads refreshed public matchup and market snapshots; injuries are not fetched automatically.

## Current-season first-half audit

See [the opening-season audit](docs/opening-season-audit.md). Regular-season calculations are research leans; the old tournament confidence percentages and filters are no longer applied to them. BetMGM openers are the fixed default benchmark, with other books selectable. Latest displayed quotes are not verified closing lines.

Run `npm run markets:refresh` to retrieve public first-half markets and period results, then `npm run audit:season` to replay the exact TypeScript model and freeze future pregame features. Missing quotes, unmatched games, and ineligible historical features are reported explicitly. The schedule now refreshes three times per day during the season. Lines and scores are snapshots, not a live feed.

## All predictions, code references, and daily downloads

The app opens on **All predictions**. Every ledger matchup has a row, including unavailable predictions with an explicit reason. The model total is computed independently of sportsbook-line availability. Choose a sportsbook and an opening/latest line for the comparison and full CSV export.

Use the **All games**, **Top 25**, and **Conferences** tabs to browse games. A conference filter includes either team; selecting a conference in Top 25 combines both filters. Rank badges use ESPN's published 1–25 rank at retrieval; missing ranks remain unknown. The filtered CSV includes every matching row across all pages and follows the selected sportsbook/line basis.

The Excel download contains **All Games**, **Top 25**, and one sheet per conference, with an **Unclassified** sheet when conference data is missing. Cross-conference games appear in both relevant conference sheets, once per sheet. Each sheet includes filters, frozen headers, Eastern tipoff times, model and book totals, the difference, research lean, team conferences/ranks, and actual first-half results. Missing numeric inputs remain blank. Excel uses BetMGM/latest and is regenerated with every successful daily refresh.

Code entry points:

| Function | Source | Purpose |
| --- | --- | --- |
| `projectFirstHalf(a, b, phase)` | [predictor.ts](src/model/predictor.ts) | Shared numeric projection used by the lab and batch output |
| `generatePredictions(ledger, generatedAt, revision)` | [predictions.ts](src/model/predictions.ts) | One structured output record per matchup |
| `predictionsToCsv(rows, sportsbook, basis)` | [predictions.ts](src/model/predictions.ts) | CSV using the selected book and line basis |
| Batch runner | [evaluate-season.mjs](scripts/evaluate-season.mjs) | Generate current feeds and today's dated files |

```sh
# Recompute every prediction from the cached public snapshots
npm run predictions:all

# Pull current team stats and markets/results, then recompute all predictions
npm run predictions:refresh
```

Downloadable feeds:

- [All predictions CSV](https://rickyhyppolite88-lang.github.io/1H-Model/data/predictions.csv)
- [All predictions JSON](https://rickyhyppolite88-lang.github.io/1H-Model/data/predictions.json)
- [Excel workbook with tabs](https://rickyhyppolite88-lang.github.io/1H-Model/data/predictions.xlsx)
- [Dated download index](https://rickyhyppolite88-lang.github.io/1H-Model/data/prediction-archive.json)
- Daily files: `data/daily/YYYY-MM-DD/predictions.csv`, `predictions.json`, and `predictions.xlsx`. Older archive entries without an Excel file retain their CSV/JSON downloads.

The JSON's `predictions` array contains `projectedFirstHalfTotal`, team names, conferences, ranks, tipoff, status, source inputs, and each book's opening/latest totals. Unavailable amounts are `null`, never zero. CSV files include conference/rank columns and are UTF-8, with spreadsheet-formula escaping for external text.

The daily archive includes only matchups on that **America/New_York** date. The regular full CSV contains all archived matchups. Dated files can update during their day; earlier dates remain available afterward. The static daily CSV uses BetMGM/latest, while the page's full CSV export follows its selected controls. All source code links in the generated feed identify the build revision.

The GitHub workflow is scheduled at **11:20, 17:20, and 23:20 UTC every day**. Each successful refresh imports current data, regenerates all CSV/JSON/Excel files, runs checks, commits the data, and deploys Pages. The open prediction screen checks for successful updates every five minutes. A stale source snapshot is not relabeled as a fresh daily archive. The currently configured season is 2026–27; season rollover still requires updating the configured season/snapshot pair.

## Green model signals and the permanent prediction record

The prediction table defaults to **Strongest model signal first**. Darker green fades toward white as the research score falls; a Tipoff (ET) sort remains available. The selected sportsbook and opening/latest basis control the signal. Excel uses the feed's BetMGM/latest benchmark and the same frozen signal function. CSV and JSON include the score, status, and `model-signal-v1` method version.

The score is `100 × abs(model − line) / 8`, halved unless the scoring-only and pace-only components both agree with the combined model's direction. A gap of eight or more points is neutral **Outlier review**, rather than automatically becoming the strongest green. Missing inputs/quotes, equal model/line totals, reconstructed estimates, and started games are neutral. Quotes/inputs captured after the ranking time cannot be used. **This is a model-support ranking, not a fitted hit probability.** Numerical scoring weights remain unchanged.

Open **Prediction record** for the shared running record, with wins/losses/pushes, pending forecasts, observed win rate, and results by frozen signal-score band. Each season/model/benchmark counts the first eligible pregame forecast for a game once. Later versions are retained and do not inflate performance counts. Grades use the original recorded line and direction; pushes are excluded from win rate. Missing data and historical estimates remain visible in All saved versions and are excluded from headline results. Changed schedules stay pending review.

Forecast changes append a version; identical refreshes do not duplicate it. Earlier forecasts are never replaced. Changed prices or lines are recorded before tipoff. Changed numerical predictions after tipoff are retained as historical estimates. Completed first-half results and subsequent score corrections append separate events. Corrections update the displayed grade while retaining the earlier observations in JSON.

- [Running record Excel](https://rickyhyppolite88-lang.github.io/1H-Model/data/prediction-record.xlsx): Record Summary, Signal Results, and Prediction Record sheets.
- [All forecast versions CSV](https://rickyhyppolite88-lang.github.io/1H-Model/data/prediction-record.csv): frozen lines, projections, scores, inputs, grades, and the counted-once marker.
- [Record index](https://rickyhyppolite88-lang.github.io/1H-Model/data/prediction-record-index.json): cumulative summaries, canonical record IDs, and dated JSON/CSV paths.
- Full forecast inputs and captured quotes are stored in `data/prediction-record/YYYY-MM-DD.json`. Prior/current team-stat snapshots are preserved under content-hash filenames in `data/input-snapshots/`; new batch records link the run snapshots and indicate whether the current snapshot exactly matches their frozen feature retrieval time. Frozen features remain the authoritative inputs for replay.

The initial record includes the public predictions observed at **5:55 PM ET on November 2, 2026**, with an immutable copy and SHA-256 receipt under `data/prediction-record/source/`. Newly calculated signal scores have their own timestamp; scores are not backdated to the observation time. The initial import preserves 184 matchups, with 89 eligible pregame forecasts. Older reconstructed results are not promoted into recorded wins.

Successful main-branch builds and the existing three daily refreshes validate, commit, and publish the record. New files are staged before the change check so fresh archive dates are retained. Pull requests validate without changing the shared record. Records are partitioned by Eastern game date so the page loads one date's detailed history at a time; global summaries and the full CSV/Excel retain the running record across dates. Manual matchup-lab saves continue to use the browser-local pick tracker.

Implementation: [signals.ts](src/model/signals.ts), [predictionRecord.ts](src/model/predictionRecord.ts), and [prediction-record.mjs](scripts/prediction-record.mjs).

## Game times in Eastern Time

All predictions, season audit, and team game checks have a dedicated **Tipoff (ET)** column with the Eastern date and AM/PM time. Conversion uses `America/New_York`, including daylight-saving changes, regardless of the viewer's local time zone. Hovering a time identifies EST or EDT.

Current prediction CSV downloads include `tipoff_date_et`, `tipoff_time_et`, and `tipoff_zone` alongside `tipoff_utc`. Both Excel reports retain sortable date/time cells and display an explicit ET suffix. UTC timestamps remain the canonical JSON source, and daily archive dates continue to use Eastern Time.

## Team offense, defense, and carryover checks

Open **Team comparison** to inspect 2025–26 final and 2026–27 observed first-half scoring, first-half points allowed, possessions, offensive efficiency, and defensive efficiency. Each row shows the season change and the blended model input. Conference and Top 25 filters narrow the team selector. Efficiency is stored as points per possession and displayed as points per 100 possessions; pace is full-game possessions. Missing current observations remain unavailable.

First-half points allowed is imported from the dated TeamRankings opponent first-half scoring table and is currently context only. The scoring formula already adjusts offense against the opponent's defensive efficiency. No new fitted coefficient or weight was introduced. Home advantage, roster continuity, transfers, injuries, and travel are not automatically modeled.

The comparison evaluates a prior-only baseline (the final prior season plus the existing league regression) against each game's frozen blended projection. Both use the same eligible completed games. The shared projection function also exposes additive team scoring estimates, so team offense error compares its estimate with actual first-half scoring, while defense error compares the opponent estimate with points conceded. Mean absolute error (MAE) and signed bias are in points. Lower MAE is better; positive bias means overestimated scoring. Market-line availability does not control scoring evaluation.

Forecasts recorded before tipoff and reconstructed season-debut estimates have separate counts and errors. Zero graded games produce blank errors. Season-end observations are descriptive and never substituted for frozen pregame features. Historical prior-season prediction archives were not recovered: these checks evaluate how the prior carries into the new season, not a backtest of predictions made during the prior season.

- [Team comparison Excel](https://rickyhyppolite88-lang.github.io/1H-Model/data/team-comparison.xlsx): Team Comparison, Season Check, Team Accuracy, and Game Review sheets.
- [Team inputs CSV](https://rickyhyppolite88-lang.github.io/1H-Model/data/team-comparison.csv): all teams, raw points-per-possession efficiency units, and separate cohort counts/errors.
- [Team evaluation JSON](https://rickyhyppolite88-lang.github.io/1H-Model/data/team-evaluation.json): source dates/URLs, prior/current/blended inputs, per-team results, and frozen game checks.

These regenerate with `npm run predictions:all` and with every successful scheduled refresh. Dated copies are kept beside the daily predictions, and the prediction archive exposes `teamXlsxPath` when that report exists. The Team comparison page checks for updates every five minutes. Source: [teamEvaluation.ts](src/model/teamEvaluation.ts); portable workbook renderer: [build_team_workbook.py](scripts/build_team_workbook.py).

To pull every predicted total from PowerShell:

```powershell
$feed = Invoke-RestMethod 'https://rickyhyppolite88-lang.github.io/1H-Model/data/predictions.json'
$feed.predictions | Select-Object awayTeam, homeTeam, projectedFirstHalfTotal
```
