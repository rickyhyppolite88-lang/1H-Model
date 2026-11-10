# 1H Model

College basketball first-half totals, rebuilt from the saved MADNESS v6.1 notes, with a new transition from the completed 2025–26 season into 2026–27.

The original Python repository and 63-game results tracker were not recovered. This is a documented reconstruction, not the original source or a claim to reproduce its historical performance.

## Open on your phone

Open [the live 1H Model app](https://rickyhyppolite88-lang.github.io/1H-Model/) in your phone's browser. The `github.com` repository link opens the source code; the `github.io` address opens the app. Bookmark the app or use your browser's **Add to Home Screen** action for quick access.

The app opens with a shared-password sign-in screen. An active session survives refreshes and brief browser closures, and locks after **30 minutes of inactivity**. Returning to a sleeping tab checks the timeout before extending the session. **Lock** closes the app immediately and locks other open tabs on the same device. The app does not mount its data-fetching screens before unlock.

Sportsbook, selected section, dates, filters, sort order, record view, team selections, and disclosure choices are remembered on that device for **seven days**. **Today** continues following the current Eastern date. Explicitly selected archive dates remain selected. **Settings & session → Reset saved views** restores defaults while preserving saved analyses, theme, and the active unlock session.

The sign-in screen is a browser convenience lock on a public GitHub Pages site. It is not server authentication: repository content and direct JSON, CSV, and Excel URLs remain public. The browser stores a session activity timestamp and view choices, not the entered password. Real protection of files would require authenticated hosting.

The app uses a green, black, and white palette. Use the **Light/Dark** button in the header to change themes; your choice is saved in that browser. On laptops, wide matchup rows align teams with model, current-line, and lean tiles, with daily records and downloads alongside the board. On phones, use the bottom bar for **Lines**, **Full record**, and **Teams**, or **More** for every model section. Matchup predictions and saved records start as compact cards showing tipoff, teams, model total, line, lean, and confidence score. Finished record cards also show the actual 1H total and grade without opening details. Tap anywhere on a compact card or use **Full details** to expand all its information; **Less detail** collapses it again. Expanded cards include confidence context, input availability, and saved-version details where applicable. Tap the expanded card's movement badge for quote timing and its effect on the recorded pick. **Daily record**, **Downloads, coverage & confidence guide**, and **Filters & search** expand when tapped. Daily Excel and CSV downloads use the same saved files as desktop. The automatic prediction record is shared across devices; manually saved Pick tracker entries remain local to each browser.

## Team jersey artwork

Team markers are lightweight illustrated basketball jerseys, using public ESPN team colors and abbreviations. They are decorative illustrations, not official uniform photographs. The bundled directory contains 362 teams; unmatched names use a neutral jersey with initials. Exact names are matched so a similarly named school never supplies another team's colors. No external image requests are needed while browsing. Refresh the separate identity snapshot with `python scripts/import_team_identities.py`; its source URL and retrieval time are stored in `src/data/team-identities.json`. This identity snapshot does not change scoring inputs or recorded forecasts.

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

The workflow scans the saved schedule every ten minutes at minutes 7, 17, 27, 37, 47, and 57. During the configured November–April season it refreshes lines when games are inside 75 minutes of tipoff, targeting a check about one hour before the start and follow-up checks closer to tipoff. Automatic market refreshes are at least 15 minutes apart, so scans normally produce a refresh about every 20 minutes during a busy pregame window. Full team-stat/schedule refreshes remain at **6:20 AM, 12:20 PM, and 6:20 PM Eastern**, with daylight-saving changes handled by `America/New_York`. It validates before committing and deploying. A GitHub Actions bot commit does not trigger another workflow run; the same run deploys the refreshed data. New-season rollover is deliberate: update the season identifier and snapshot pair after the current season ends.

Public statistics: [TeamRankings college basketball](https://www.teamrankings.com/ncaa-basketball/). Every JSON snapshot records exact dated source URLs and retrieval time. The stat values use points per possession, not points per 100 possessions. Display precision follows the public source.

## Deploy on GitHub Pages

1. Push this source to `rickyhyppolite88-lang/1H-Model` on `main` using an account with write permission.
2. In **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
3. Let **Validate and deploy 1H Model** finish. The deployment's actual URL appears in the `github-pages` environment.

The expected repository Pages address is `https://rickyhyppolite88-lang.github.io/1H-Model/`, but it is not live until the first deployment succeeds. The workflow sets the repository base path; local development runs at `/`. [Vite's Pages instructions](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub's workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) describe the deployment mechanism.

The batch job uses the shared TypeScript projection function. The prediction page reads refreshed public matchup and market snapshots; injuries are not fetched automatically. The pick tracker preserves previously saved manual analyses in that browser's local storage and does not sync between devices. Export records to retain a copy.

## Current-season first-half audit

See [the opening-season audit](docs/opening-season-audit.md). Regular-season calculations are research leans; the old tournament confidence percentages and filters are no longer applied to them. The running record uses the original eligible BetMGM/latest forecast; other books are selectable for comparison. Openers remain archived for movement analysis. Latest displayed quotes are not verified closing lines.

Run `npm run markets:refresh` to retrieve public first-half markets and period results, then `npm run audit:season` to replay the exact TypeScript model and freeze future pregame features. Missing quotes, unmatched games, and ineligible historical features are reported explicitly. Automatic pre-tip refreshes retrieve today’s lines/results without reimporting team stats each time. Started games receive follow-up checks for missing first-half results for up to four hours after tipoff. Outside the pre-tip window, discovery is due every **30 minutes while games on today's Eastern slate remain upcoming**, or every two hours when idle. A new Eastern date requests a full refresh so the new slate and team stats are discovered together. GitHub scheduled jobs can run late; the page displays the actual source check time and warns when today's capture is over 45 minutes old. Lines and scores are snapshots, not a live feed.

## All predictions, code references, and daily downloads

The **Lab** tab collects versioned research forecasts separately from the actual model. **Prediction record → Actual / Lab** switches between the existing official history and finished experimental first halves. Lab methods explain their rules, distinguish qualified from watch-only forecasts, compare against the baseline on the same saved lines, and expose raw measurement gaps. Collection starts prospectively; no historical replay is added to its win rate. See [Research Lab methods, records, and shared pause controls](docs/research-lab.md).

The app opens on **Today’s lines**, showing only the current Eastern calendar date. The prominent **Game date (ET)** control changes both the table and dated downloads; **Today** returns to the current day. Earlier dates are shown only when selected, and a missing current-day refresh never substitutes yesterday’s games. The Today selection follows the Eastern date across midnight.

Use **All games**, **Not tipped off**, and **Tipped off** to filter the selected date. Counts follow the conference, Top 25, search, and coverage filters. Tipoff status updates every minute using the scheduled start time and latest reported game status; delayed games remain upcoming, while postponed/canceled games appear only under All games. Lines and reported game status still come from the scheduled public-data refresh, rather than a live sportsbook feed. Missing quotes display **No feed line**. This never proves the book has not posted the market.

Source reconciliation and data-gap checks run in the background without a coverage block above the board. Upcoming pregame OVER/UNDER leans with a current selected-book line appear first; other games follow, with the chosen confidence or tipoff sort applied within each group. Changing sportsbooks recalculates the grouping. The Lab lists qualified research first, then watch-only forecasts and data gaps; finished records retain their date order. The **Projection coverage** filter still offers **Missing selected-book line** and **Missing here; other books have lines** for reviewing gaps. The CSV includes `market_data_status`, `market_source_checked_at`, and `other_books_with_current_lines`; the Excel Availability column uses the same source status when model inputs are available.

The importer reconciles every observed source game/book line into imported or unmatched counts and joins only verified team names/aliases plus start time. `marketChecks` retains daily source counts; `marketCoverage` on each checked game records whether a source matchup was verified and which books supplied current totals. Historical quotes remain archived with their original capture times when a book or game disappears. Those retained quotes do not become current comparison lines or research signals. A quote missing from the aggregator can still exist at a sportsbook; a second independent source would be needed to resolve that source-coverage gap automatically. No other book is substituted into the selected book's record.

The **Record for [date]** card follows the Eastern date selector in Today’s lines and the **By day** record view. It shows that whole day’s wins/losses/pushes, pending picks, observed win rate, and counted pregame picks, using the official original saved forecast and line for the recorded benchmark. Search, tipoff, conference, sportsbook display, and coverage filters do not regrade or change this whole-day record. Later versions cannot count twice; result corrections and changed-tipoff reviews follow the running-record rules. The selected day’s all-games record CSV is available from the card. A missing record or failed request is shown explicitly, and an ungraded day has no hit-rate percentage.

The table always uses the **current 1H line**. A small **green +** or **red −** shows current minus opening points at the selected sportsbook; zero is neutral and `?` means movement cannot be calculated from the retrieved data. Hover, focus, or tap the badge for opening/current totals, movement, the effect on the model’s lean and edge, the original recorded pick, and the quote retrieval time. Colors describe movement direction. For a graded recorded pick, the tooltip shows the hypothetical outcome of the same side at the current line; the official grade stays on the original saved line. Pending picks show how the new threshold compares with their saved line. Recorded picks are matched by date, season, model, sportsbook, and official benchmark, without borrowing another book’s pick. Point movement does not compare odds-price changes. The CSV keeps both opening and current totals, with the current line as the comparison.

**Projection data gaps** mean the model cannot calculate a valid total: team statistics are outside coverage/could not be matched, or there is no valid pregame snapshot. The game is **Unrated · data gap**, not a qualified model pick. The game’s row retains the specific missing-data reason. **No line to compare / Not posted** means a model total may exist, but the selected sportsbook line was absent from the latest retrieved update, so no over/under edge is available. These are data/coverage states rather than an unfavorable model signal. Historical estimates were first available after tipoff and remain outside the recorded pregame win rate. The app explains these distinctions in **Understanding unavailable games**.

Every ledger matchup remains available on its game date, including unavailable predictions with an explicit reason. The model total is computed independently of sportsbook-line availability. Choose a sportsbook for the current-line comparison. The main CSV and Excel downloads follow the selected date; **Download filtered** also follows the tipoff/group filters across all pages. The explicitly labeled **All dates CSV** retains the full export.

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

The lightweight schedule planner skips builds when no refresh is due. Each due refresh regenerates CSV/JSON/Excel files, runs checks, commits the data, and deploys Pages. Workflow runs queue instead of canceling each other, and default-branch checkouts use the latest saved history before applying updates. Generated source references identify the actual checked-out commit. Manual dispatch supports `refresh_data=true` for a full import or `refresh_lines=true` for markets/results only. The open prediction screen checks for published updates every five minutes. A stale source snapshot is not relabeled as a fresh daily archive.

The hour-before target is best-effort: [GitHub scheduled events can be delayed or dropped under load](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). The wider pre-tip window and repeated scans improve coverage, but a schedule alone is not evidence of a fetched quote. Each movement tooltip shows the actual quote retrieval time and its minutes before/after scheduled tipoff; missing quotes remain explicit. GitHub run summaries explain which checks ran or skipped. The currently configured season is 2026–27; season rollover still requires updating the configured season/snapshot pair.

## Model signals and the permanent prediction record

The prediction table defaults to **Highest confidence score first**. Cards use a neutral background and show **Confidence** as a percentage of the existing 0–100 model-strength score beside the research lean. This is explicitly labeled an uncalibrated model score, **not a win probability**. Every valid scored lean has a visible rating: ordinary numerical strength or **Review** for an 8+ point outlier. Missing inputs and exact-line ties show explicit statuses. After tipoff, **Shown-line score** uses only the displayed model components and selected line and is marked **After tip · shown line**; it is not a saved pregame confidence and never reopens the upcoming ranking. Historical reconstructions are marked **Historical estimate**. Finished records retain each original score; older missing scores can be calculated from their frozen projection/components and original entry line, with **Derived confidence / Calculated later** shown on the card. These derived values never overwrite archived scores or enter the original-score performance bands. Actual 1H totals and grades remain visible while collapsed. Archived JSON and Excel retain original signal scores; CSV appends `display_score`, `display_rating`, `display_score_source`, and `display_score_reason` separately. A Tipoff (ET) sort remains available. The selected sportsbook’s current line controls the upcoming score. Excel uses the feed's BetMGM/latest benchmark and the same frozen signal function.

The score is `100 × abs(model − line) / 8`, halved unless the scoring-only and pace-only components both agree with the combined model's direction. A gap of eight or more points is neutral **Outlier review**, rather than automatically becoming the strongest signal. Missing inputs/quotes, equal model/line totals, reconstructed estimates, and started games are neutral. Quotes/inputs captured after the ranking time cannot be used. **This is a model-support ranking, not a fitted hit probability.** Numerical scoring weights remain unchanged.

Open **Prediction record** for the shared running record, with wins/losses/pushes, pending forecasts, observed win rate, and results by frozen signal-score band. Each season/model/benchmark counts the first eligible pregame forecast for a game once. Later versions are retained and do not inflate performance counts. Grades use the original recorded line and direction; pushes are excluded from win rate. Missing data and historical estimates remain visible in All saved versions and are excluded from headline results. Changed schedules stay pending review.

Forecast changes append a version; identical refreshes do not duplicate it. Earlier forecasts are never replaced. Changed prices or lines are recorded before tipoff. Changed numerical predictions after tipoff are retained as historical estimates. Completed first-half results and subsequent score corrections append separate events. Corrections update the displayed grade while retaining the earlier observations in JSON.

- [Running record Excel](https://rickyhyppolite88-lang.github.io/1H-Model/data/prediction-record.xlsx): Record Summary, Signal Results, Daily Coverage, Daily Games, and Prediction Record sheets.
- [All forecast versions CSV](https://rickyhyppolite88-lang.github.io/1H-Model/data/prediction-record.csv): frozen lines, projections, scores, inputs, grades, and the counted-once marker.
- [Record index](https://rickyhyppolite88-lang.github.io/1H-Model/data/prediction-record-index.json): cumulative summaries, canonical record IDs, and dated JSON/CSV paths.
- Full forecast inputs and captured quotes are stored in `data/prediction-record/YYYY-MM-DD.json`. Prior/current team-stat snapshots are preserved under content-hash filenames in `data/input-snapshots/`; new batch records link the run snapshots and indicate whether the current snapshot exactly matches their frozen feature retrieval time. Frozen features remain the authoritative inputs for replay.

The initial record includes the public predictions observed at **5:55 PM ET on November 2, 2026**, with an immutable copy and SHA-256 receipt under `data/prediction-record/source/`. Newly calculated signal scores have their own timestamp; scores are not backdated to the observation time. The initial import preserves 184 matchups, with 89 eligible pregame forecasts. Older reconstructed results are not promoted into recorded wins.

Successful main-branch builds and due automatic refreshes validate, commit, and publish the record. New files are staged before the change check so fresh archive dates are retained. Pull requests validate without changing the shared record. Records are partitioned by Eastern game date. **All dates** loads all dated archives; selecting a date loads only that archive and reuses already loaded archives. Shared record/result IDs are deduplicated, result corrections remain in time order, and an archive failure never displays partial totals or history. The full CSV/Excel retain every saved forecast across dates. Previously saved manual analyses remain in the browser-local pick tracker.

Implementation: [signals.ts](src/model/signals.ts), [predictionRecord.ts](src/model/predictionRecord.ts), and [prediction-record.mjs](scripts/prediction-record.mjs).

### Complete daily game coverage

The running record shows games once their **first-half result is final**, even if the second half is still in progress. Open it with **Full record** on the phone's bottom bar or **Prediction record** on desktop. The **Daily breakdown (ET)** dropdown inside **Full prediction record** switches between all dates and one date, updating that same summary box and the finished-game list below it. Changing date clears search/view filters. Upcoming games remain in Today's lines and the permanent archives/downloads.

The default table has one row per finished matchup, using the counted original forecast when available, then the best saved pregame/historical estimate. Full history shows newer dates first; daily history follows Eastern tipoff order. **Record view** can show finished games, official graded results, or every saved version of finished games. Version numbers and recording timestamps appear only in the all-versions view. The summary counts only original eligible settled picks, excluding pushes from win rate. Completed games with missing model inputs, unpriced forecasts, historical estimates, or schedule-review issues remain visible without inflating the official record. Signal-band results, coverage, counting rules, and complete source downloads are expandable details. OVER text is green and UNDER text is red in both themes. Confidence percentages replace the background fade and retain each original saved model-strength score; they do not estimate a bet's hit probability.

The dated `YYYY-MM-DD-games.csv` download contains one row per game. The existing dated CSV retains all versions. Excel's **Daily Coverage** sheet reconciles game/projection/status counts by Eastern date, and **Daily Games** lists all matchups with their predictions, recorded lines, actuals, and coverage status. The other sheets retain the cumulative performance record and every forecast version.

For November 2, 2026, the 182-game ESPN Division I schedule is fully represented: 119 saved projections and 63 games with missing model inputs. An earlier successful deployment proves the UAB–McNeese forecast was published at 5:01 PM ET, before its 5:30 PM tipoff. Its original BetMGM/latest line of 71.5 is recovered into the pregame record. This raises counted forecasts from 89 to 90; the seven remaining historical estimates stay outside the recorded hit rate. Twenty-two projected games lack a recorded benchmark line. The source snapshot, hashes, deployment URL, and publication/import timestamps are retained under `data/prediction-record/source/2026-11-02-pretracking-*`.

Recovery only fills missing eligible pregame benchmarks from a verified immutable published archive. It does not replace existing counted forecasts, alter their lines, import old result observations over newer scores, or backdate signal calculations. Recovered records append a new unique version ID while preserving their actual publication time separately from import time.

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
