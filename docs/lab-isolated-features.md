# Isolated first-half component trials

V5 (`opponent-paper-v5`) and V6 (`shooting-paper-v6`) are separate prospective 1u paper trials. Actual, earlier Lab methods and immutable saved results are unchanged. Historical replays do not create stake assignments or enter the live calendar.

## Common rules

- Fit one immutable feature model per Eastern date, using reconciled, same-season D1 halves from **earlier Eastern dates**, observed by fitting time. Later corrections, same-day games, invalid shot counts and collector-error games are excluded.
- Require 30 league halves and at least one earlier half for each team. Missing history is a gap, not a zero-valued team.
- Use captured pregame Actual features and a verified current DraftKings quote, both valid side prices, and quote/check ages no greater than 45 minutes at capture.
- Correct only the **current-season portion of the 60% historical-scoring branch**. Keep the prior-season portion and the 40% pace/efficiency branch unchanged. Use the existing frozen current-season weights.
- Cap the combined total adjustment at ±3 points. Do not stack these corrections with each other, venue, fouls or referees.
- Take one 1u paper entry for every usable numerical lean. Exact-line no-leans and 8+ point review gaps stay watch-only. Confidence is the existing model-strength score, not a calibrated win probability; it does not size these stakes.
- Freeze the latest usable pre-tip snapshot once per game. A later gap cannot erase an earlier usable entry. Grade completed first halves and settle using the saved side's American price. Never backfill prospective stakes.

## V5: previous-opponent strength

Estimate first-half possession exposure using `(FGA − ORB + TO + 0.475 × FTA)`, averaged across teams. Fit an additive points-per-possession model, `league + team offense + opponent defense`, with four league-average halves of shrinkage and 40 fixed alternating updates.

Compare the opponent-adjusted offensive rate with an **equally shrunk** unadjusted rate. This isolates schedule correction from a new general shrinkage effect. For each team:

`point change = 0.6 × frozen current-season weight × expected half possessions × (adjusted offensive rate − shrunk unadjusted offensive rate)`.

Expected half possessions are `(away frozen pace + home frozen pace) / 4`. This is a prior-opponent correction; it does not add a second current-opponent defensive adjustment on top of Actual's existing efficiency branch.

## V6: three-point conversion regression

Keep observed three-point attempt volume. Estimate conversion with 50 league-rate prior attempts:

`regressed 3P% = (team 3PM + 50 × earlier league 3P%) / (team 3PA + 50)`.

`delta per possession = 3 × (regressed 3P% − observed 3P%) × team 3PA / team possession exposure`.

Apply the same frozen current-season/scoring weight and matchup possession normalization as V5. A team with zero prior three-point attempts receives a neutral shooting change, with the missing observed percentage retained as null. This is a conversion-regression hypothesis; it does not measure shot location, contest or shot quality.

## Historical and forward evaluation

Run `npm run lab:backtest` from the repository root. It writes `.cache/lab-feature-backtest/summary.json` and `games.csv`, reading archived feature/quote versions without changing records. A positional output directory is supported.

Each historical capture date fits before its first archived pregame forecast, then replays only eligible forecasts using inputs actually available at their capture time. Each method keeps its latest usable pre-tip entry. Outcomes must be observed by the requested replay cutoff. Baseline controls use the identical games, lines, times and corresponding side prices. Cohorts can differ between V5 and V6; compare each to its own matched control. Current schedule/result corrections are honored, so this remains retrospective research.

At the November 18, 2026 4:03 PM ET source snapshot, each trial had 385 replayed games and a 185–200 record. V5 returned −39.18u versus −39.10u for its matched Actual control; V6 returned −39.14u versus −39.10u. Point MAE improved slightly: V5 8.607 versus 8.615; V6 8.603 versus 8.619. These results do not establish an edge. The fixed constants above were not tuned to improve these replay outcomes.

The app's **Historical replay & test plan** disclosure updates separately from the prospective record. Refreshes publish immutable daily models under `data/lab-feature-models/`, the current model, and a separate historical summary. No raw export buttons are added to the app.

Forward checkpoint: at least **30 days and 300 matched completed prospective plays per method**, whichever takes longer. Review data collection weekly. Keep feature definitions, constants, caps and selection rules fixed; daily input updates are allowed. Review net units, ROI at saved prices, point MAE, coverage and paired controls. Reaching the checkpoint or showing a positive run is not automatic promotion. A subsequent untouched time period must confirm any proposed change.
