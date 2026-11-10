# Research Lab

The active Lab version (`enhanced-baseline-v2`) starts with the unchanged Actual 60% scoring / 40% pace-efficiency core, then adds first-half defense, venue/matchup context and a joint foul/free-throw adjustment. The qualified-baseline selection rules apply to the final total. Actual's projection formula and saved forecasts are unchanged; result corrections remain append-only. Earlier Lab versions are paused by default and remain accessible under **Lab version & history**. Each new version starts a genuinely new pregame record; completed games are not backfilled.

## Methods and predeclared rules

| Version | Forecast | Decision / evaluation |
| --- | --- | --- |
| `enhanced-baseline-v2` | Actual + 1H defense + home/away, neutral, conference/tournament and crowd context + joint foul/FTA points | Context capped at ±4; joint FT/foul points capped at ±2. Same 1.5-to-below-8 edge and adjusted-component agreement rule. Bonus timing is measured without stacking another FT bonus. |
| `enhanced-baseline-v1` | Actual algorithm + first-half defense + bounded bonus points | Previous combined model. Qualify only when `1.5 <= absolute edge < 8` and both adjusted scoring and pace components agree. Other usable projections are watch-only; missing factors are data gaps. |
| `baseline-control-v1` | The unchanged model at the Lab capture time | Track every priced non-push research lean as a control. This is not a qualified betting system. |
| `qualified-baseline-v1` | The same total | Qualify only when the absolute gap is at least 1.5 and below 8 points and both scoring and pace components agree with the side. All other usable priced forecasts are watch-only. |
| `first-half-defense-v1` | `0.6 × (both 1H points scored + both 1H points allowed) / 2 + 0.4 × original pace/efficiency component` | Apply the same qualification rule. Prior allowed values receive 35% regression to the available prior league mean, then the original frozen current-season weights. Missing defensive inputs block this method. |
| `bonus-exposure-v1` | Combined expected minutes after opponents reach a seventh logged nontechnical foul | Measurement only. Score timing error against the observed proxy and the earlier league-average bonus baseline. It does not forecast a points adjustment or a bet. |

The first-half-defense experiment locates the archived current dataset by the original feature snapshot's `statsRetrievedAt`. It does not silently substitute the latest season snapshot. If a team has positive current weight but that exact dataset or its allowed field is missing, the method records a data gap. The frozen input record includes four-metric baseline values, weights, allowed values, dataset paths, source check times, and code revision.

The bonus prototype uses only reconciled earlier halves actually observed before its forecast timestamp, excluding the target game and sources currently flagged as unresolved. Defensive foul rates and opponent foul-drawing rates each receive four league pseudo-games. Their product divided by the league foul rate estimates expected fouls. A Poisson arrival model is integrated over 20 minutes to estimate remaining bonus exposure after the seventh event. Both offenses' minutes are summed, so the combined range is 0–40 minutes. The forecast freezes its history cutoff, excluded games, league baseline, and team sample counts.

This is an unvalidated, sparse-data experiment. It has no roster or referee adjustment. Men's one-and-one begins with the seventh team foul, double bonus with the tenth, and team fouls reset after the first half; see the [NCAA's 2026–27 rules comparison](https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/common/2026-27PRXBB_MajorRulesDifferences.pdf). Our logged-nontechnical-foul proxy omits technical classifications that can count toward official team fouls. It is not an exact official bonus reconstruction, and free throws after the threshold are not necessarily caused by the bonus.

## Combined model and bonus points

### Active v2: venue, game type, crowds and foul/free-throw exposure

`Lab v2 total = first-half-defense-adjusted core + context delta + joint FT/foul delta`. The two deltas are applied to both components before qualification, preserving their 60/40 identity. Missing usable context or fewer than 30 reconciled earlier D1 halves for foul/FTA inputs produce a data gap, rather than a fabricated zero forecast.

ESPN's declared home/away and neutral-site flags, conference-game flag, venue and explicit event/bracket notes determine the context. A standalone showcase is not automatically labelled a tournament; unresolved postseason classifications remain explicit. Team-specific home/away effects and neutral/conference/tournament/crowd effects are fitted jointly to residual errors left by the Actual core, with sample-size shrinkage. Prior-season dated end statistics are in-sample training controls; current-season baseline controls come from original recorded pregame forecasts. Team exposure baselines follow the frozen core's season weights and 35% prior league regression. These are research associations, not causal estimates or demonstrated improvements. Development replays did not justify promoting context adjustments into Actual.

Crowds use **earlier venue attendance averages**, with at least three observations. The target game's attendance, ticket listings, live noise and fan allegiance are not inputs. A crowd below **3,000** estimated attendees contributes exactly **zero crowd adjustment**, including centering offsets; it does not penalize a small team. Missing/sparse attendance is also neutral. This cutoff is a provisional guardrail, not a claim that all smaller venues are quiet. Home/away performance can still contribute independently.

The joint foul/FTA module uses only earlier observed, reconciled first halves and excludes the target game and unresolved sources. Team fouls committed, opponent fouls drawn, FT attempts drawn/allowed, estimated possessions, FT makes and conversion rate are shrunk with four league pseudo-games (FT percentage receives 30 prior attempts). It forecasts defensive foul rates against the opponent's foul-drawing rate, then estimates FT attempts from offensive and defensive FT-per-foul tendencies at the expected first-half pace. The points adjustment uses the matchup deviation from each offense's neutral-opponent FT baseline, bounded at ±2, to avoid simply adding team FT production already present in scoring averages.

Seven-foul chances are Poisson estimates for **logged nontechnical fouls**, not calibrated official referee-call probabilities. FT-attempt ranges allow league-estimated overdispersion via a Gamma-Poisson count model; the displayed ranges target a central 80% model interval. No individual referee assignments or referee call-rate data are available. The original seventh-foul/bonus-timing proxy remains recorded, but the earlier v1 bonus-points term is **not** added again: fouls, bonus exposure and FTs overlap.

Each saved observation contains the venue/context model hash and capture cutoff, crowd eligibility, expected per-team FTAs and fouls, count ranges, seventh-foul probabilities and frozen joint point adjustments. After a first half completes, reconciled actual FTAs/fouls appear in game details and CSV. The Lab record also reports combined-count MAE and seventh-foul probability Brier score, with sample count, separately from betting outcomes. These probabilities and ranges remain uncalibrated until enough prospective results exist.

`context-history.json` retains content-addressed observations and source-day URLs/checksums; `context-model.json` is the latest fitted research artifact, with immutable copies under `data/context-models/`. Normal scheduled refreshes collect new outcomes and refresh the fit only when its inputs change. These files support Lab research and do not change the Actual prediction formula or record.

### Previous v1: bounded bonus timing adjustment

The combined version reuses the defense branch described above, then adds a bonus-points delta. The league-neutral reference is `2 * expectedBonusMinutes(leagueFouls)`, so a league-prior matchup receives zero adjustment. A ridge fit relates combined first-half free-throw makes to observed bonus-proxy minutes, controlling for estimated possessions per team: `(FGA - offensive rebounds + turnovers + 0.475 * FTA) / 2` across the two teams.

The fit requires at least 30 earlier D1 halves with reconciled scoring and free-throw makes. Both centered regression slopes receive 50 prior-game equivalents of shrinkage toward zero. The bonus slope is bounded to 0–1 point per minute and the final delta to ±2 points. No bonus variation makes the fit unavailable; a valid nonpositive association yields a zero slope. These are predeclared experimental safeguards, not parameters optimized against yesterday's bets or demonstrated improvements. Foul timing, free throws and pace remain confounded, and the adjustment may duplicate information already in scoring/efficiency. Prospective comparison must determine whether it adds value.

`Lab total = defense-adjusted total + bonus delta`. The same delta is applied to each component before checking agreement, preserving the 60/40 identity. Missing defense or insufficient bonus history blocks the combined forecast. No missing factor is silently replaced with zero. Frozen inputs retain the Actual total, both original components, defense total/delta, bonus total/delta, fitted coefficient, history count/cutoff, source exclusions and bounds. Each card expands to show **Actual → defense → bonus → Lab**; CSV includes the calculation and frozen inputs.

Free-throw makes are an optional field for compatibility with older raw versions. Enriching an old measurement appends a new content-addressed observation at the real extraction time; earlier records and first-observed timestamps remain intact. A per-version collection start prevents the new combined model from claiming an earlier prospective history.

## Decisions, results, and comparison

The first usable priced observation fixes a method's decision for a game, including **watch-only**. Later line moves cannot promote that original watch-only decision into the qualified record. If inputs or a price were genuinely missing, the first subsequent usable priced pregame observation becomes the decision. For bonus timing, the first usable measurement forecast is the decision, independent of whether a market line exists.

Numerical or price changes before tipoff append versions. Identical captures do not duplicate forecasts. No forecast is created after scheduled/reported tipoff, backdated, or reconstructed from a completed game. Source timestamps must precede the capture.

A changed tip time initially requires review. A completed-half result can resolve it when a trusted ESPN source identifies the same season/game and both teams, the change stays within six hours on the same Eastern date, and the original forecast preceded both tip times. Frozen ESPN/model IDs must match when available; legacy rows require exact saved team names. Lab forecasts with venue/context inputs also require the same venue, neutral-site flag, conference flag and game type. Missing identity evidence, different dates/opponents/venues or a forecast after the corrected tip remain ungraded. Time comparisons use instants, avoiding false mismatches from equivalent ISO formatting. Result events append participant and context evidence; forecast timestamps, lines, totals and IDs are never rewritten. Cards label verified changes, and CSV includes `schedule_status` and `result_tipoff_utc`.

### Component comparison

**Lab component comparison** appears in both the Lab and Prediction record → Lab, respecting the selected date or all dates. It measures the Actual core, defense branch, defense plus context, defense plus foul/FT, full v2, and full-model removals of home/away, neutral-site, game-type and crowd effects. Values come entirely from original frozen v2 observations; no latest statistics or fitted coefficients are substituted. Removing a context factor recomputes the original ±4 cap on the remaining saved factors.

Every row uses the same completed, reconciled cohort with all components available. MAE includes unpriced and watch-only projections; W/L/P holds the full Lab's original qualified/control cohort and entry lines fixed. Component totals exactly on the saved line are reported as no lean. These are descriptive component replays, not newly qualified bets, independent official records or proof of predictive improvement. Missing components and unresolved schedule reviews are excluded from every row equally. The UI and CSV show sample counts and MAE differences from the core. No result automatically changes Actual's weights or promotes a component.

The comparison recalculates as results arrive. Each normal publication also writes `data/lab-components.csv` for all dates and `data/lab/YYYY-MM-DD-components.csv` for individual dates; the page offers its own date-scoped CSV download.

A source check or selected-book quote over 45 minutes old is a market data gap, not a usable Lab entry. Its last-seen line remains in frozen inputs; the first subsequently usable priced observation establishes the decision. Bonus timing can still be measured independently of market availability. A new code build therefore cannot accidentally count an old retained line as a current experimental entry price.

The Lab record shows only games with completed first-half result events, including games whose second half is still in progress. Qualified/control decisions enter win/loss totals; watch-only and missing-data cases remain visible but excluded. Pushes are excluded from the hit-rate denominator. Actual totals appear directly on the cards. Watch-only hypothetical outcomes are available in details and CSV, explicitly labeled.

The matched baseline uses the unchanged total on **the experiment's same saved games and BetMGM lines**. The Lab starts later than the Actual record, so their aggregate win rates are not a comparable cohort. Reports include qualification coverage and point error on all projected games, including watch-only forecasts. Bonus timing has a separate minutes-error sample and no betting win rate.

Signal strength is shown as a score out of 100, not a probability. Observed outcomes by strength band are descriptive; no calibrated probability, Brier score, or claimed advantage is invented. Changing numerical rules requires a new versioned method and tests; it must not rewrite earlier observations or automatically promote a challenger.

## Pages and controls

- **Lab** in desktop navigation and the phone's bottom navigation: opens the combined model, with older experiments under **Lab version & history**. Inspect upcoming saved forecasts, expand the calculation and download its CSV.
- **Prediction record → Actual / Lab**: preserve the existing Actual view; the Lab view offers its own method selector and daily date dropdown. Both views retain their filters across refreshes.
- **Method controls & data sources**: shows the shared collection status, source coverage, raw measurement gaps, and an owner-only link to collection controls.

GitHub Pages cannot securely write shared settings with the app's shared screen password. Shared collection therefore uses the existing authenticated owner workflow, without placing a GitHub credential in the browser. Open the linked workflow, choose **Run workflow**, select `lab_method`, and choose `enable` or `disable` under `lab_action`. The completed run commits the changed configuration and deploys it. `keep`/`none` make no configuration change.

Pausing stops new observations for that method across devices. It does not delete history or stop already saved forecasts receiving completed-half results and corrections. Resuming does not backfill missed games. The browser's method selector changes only the visible method; it does not pretend to pause shared collection. Existing Method & rules documentation remains available for the actual model.

## Data pipeline and integrity

`scripts/import_lab_halves.py` retrieves public ESPN summaries for completed first halves. Team IDs and both teams' points must reconcile to the ledger and summary before a measurement is accepted. Summary `displayValue` strings are normalized to numeric scores. Free-throw misses are recognized by the scoring flag even when the provider labels the event `MadeFreeThrow`; explicitly labeled free throws with missing attempt metadata are handled. Repeated event IDs are deduplicated. Missing scores and play-by-play become visible gaps, not zeros.

Unchanged measurements retain their first-observed time. Corrections append new content-addressed versions with retrieval timestamps and source hashes. Recent halves are revisited after six hours, and changed ledger scores trigger an immediate recheck. Bonus grading requires the raw measured score to match the latest completed-half result; otherwise its measurement remains pending.

The existing `audit:season` pipeline calls `scripts/lab.mjs` after the Actual record is saved. It loads existing Lab archives, rejects conflicting immutable IDs, captures eligible future games, and adds result events without changing predictions. A missing indexed archive is fatal rather than treated as an empty history. Lab results never enter the Actual index or totals.

Files:

- `public/data/lab-config.json`: shared collection flags for versioned methods.
- `public/data/lab-halves.json`: append-only measurement versions, latest check times, and unresolved raw-source gaps.
- `public/data/lab-index.json`: collection start, publication timestamp, current game status, configuration, coverage, and dated archive paths.
- `public/data/lab/YYYY-MM-DD.json`: frozen forecasts, completed-half result events, and relevant raw outcome versions.
- `public/data/lab/YYYY-MM-DD.csv`: all methods and versions for that Eastern game date, including qualification, actuals, and original-decision markers.

The page CSV contains all observations for the selected method/date, including watch-only and pending versions. The on-page Lab record remains finished-only. No independent source or other book is silently substituted when BetMGM is missing. Lab source data and exports are public static files under the already documented screen-lock hosting arrangement.

```sh
python scripts/import_lab_halves.py
npm run audit:season
python scripts/configure_lab.py --method first-half-defense-v1 --action disable
```

The normal Pages workflow collects raw measurements on due refreshes, and on the first production build if the raw store does not yet exist. Pull requests run isolated collection/model tests without a live raw fetch. CSV/JSON archives regenerate and deploy with validated data; an open Lab screen checks for published changes every five minutes.


### Entry books and future tipoff selection

New forecasts default to DraftKings. Prior recorded books and decisions remain unchanged for games already started when the persisted `last-pretip-v1` policy begins. Future games use the latest captured pre-tip decision across book versions; qualified unit records additionally require a source quote verified within the final 15 minutes. A final watch-only or data-gap decision receives no stake. Immutable older observations remain in the archives. Full-record cards, totals and unit CSVs show only staked entries, while the main Lab retains the broader research history and bonus measurements.
