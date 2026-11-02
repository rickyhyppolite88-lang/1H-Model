# Model specification

## Provenance

Rebuilt on November 2, 2026 from the workspace's `predict/SKILL.md` and saved MADNESS v6.1 memory. No original `predictor.py`, database, scraper, or pick tracker was found. Preserve this distinction when discussing performance or changing formulas.

The saved version was a tournament model, active March 20, 2026, incorporating March 19 adjustments. Historical rule labels are not recalibrated probabilities for the reconstructed formula, a new season, or regular-season games. The app deliberately shows no inherited win-rate claim.

## Inputs and snapshots

Men's NCAA basketball team stats are imported from TeamRankings' dated public first-half points, possessions, offensive efficiency, defensive efficiency, and schedule-strength tables. Season labels use start/end years; the public season table header uses the start year (e.g. `2025` for 2025–26). Team games played come from the wins/losses record in the dated schedule-strength table.

Two independent snapshot files retain their season, as-of date, retrieval timestamp, exact source URLs, and nullable metrics. Offensive/defensive efficiency is points per possession. Tables must have matching team IDs. Archived teams without source links receive explicit `unlinked-` IDs based on their visible names; they are never fuzzily attached to another program.

At import, zero-game team metrics are null even if a source displays preseason ratings. At prediction, only a positive game count and all four observed core metrics receive current-season weight. Source columns for recent games or the prior comparison year are never substituted for the selected season column.

A prediction must belong to the current season and cannot use a snapshot with an as-of date after its matchup date. This is a daily snapshot model; it cannot establish an intraday pre-tipoff cutoff. Do not treat a same-day final snapshot as a verified pregame snapshot for already completed games.

## New season bridge (new, not present in recovered v6.1 notes)

The previous season's final team statistic is regressed toward the unweighted mean of complete prior-season team statistics. Current observations are then blended with `currentGames / (currentGames + priorEquivalentGames)`. Defaults: eight equivalent prior games and 35% regression. Neither default was tuned or validated on held-out games.

The blend operates separately for each team and for scoring, pace, offense, and defense. Missing prior metrics use the prior league mean. Incomplete current metrics conservatively retain the regressed prior across all four metrics. Previous-season SOS is not transferable and is never carried forward. PACE OVER requires known positive SOS observations for both current teams.

Roster continuity is unknown. The regression is a coarse safeguard against treating a changed roster as identical; it is not a transfer/returning-production adjustment.

## Projection

The recovered scoring equation was:

```text
projection = 0.6 * simple_1H_sum + 0.4 * pace_adjusted - 4.0
```

The definition of `pace_adjusted` was missing. This reconstruction explicitly defines:

```text
simple_1H_sum = blended_1H_ppg_A + blended_1H_ppg_B
expected_pace = (blended_pace_A + blended_pace_B) / 2
expected_PPP_A = (blended_OE_A + blended_DE_B) / 2
expected_PPP_B = (blended_OE_B + blended_DE_A) / 2
pace_adjusted = expected_pace * (expected_PPP_A + expected_PPP_B) / 2
```

The division by two converts full-game pace into a first-half estimate. Arithmetic pace and efficiency averaging are reconstruction choices, not recovered code. NCAA tournament context retains the saved −4-point suppression. Regular season defaults to zero suppression; that intercept also needs validation.

Calculations retain full imported precision until display. Model edge is the absolute distance between the unrounded projection and the line. PACE OVER can oppose the model lean; the interface shows the raw lean, edge, and override separately.

## Saved rule reconstruction and priority

1. Either blended OE below 0.96: NO BET, overriding all other tiers.
2. PACE OVER: absolute pace gap at least 5, both OE at least 1.05, and both current SOS ratings positive. This selects OVER with the saved 75% label regardless of model direction or edge filters. Three or more combined reported injuries block it.
3. Otherwise, model edge at least 8: NO BET. Edge below 1.5: NO BET. OVER with edge below 2: NO BET. Three or more combined injuries block any OVER.
4. LOCK: line strictly below 68, UNDER, and edge inclusively from 2 through 3. Saved label: 95%.
5. PRIME UNDER: UNDER edge inclusively 2–3 adds 15 to the historical rule label. A sub-68 UNDER adds 5; an UNDER pace gap inclusively 2–4 adds 5. The saved base confidence for ordinary PRIME UNDER was not recorded, so the app shows no invented numeric probability.
6. A 1.5-to-under-2 UNDER has a saved 70% base label; the recorded low-line and pace boosts can be added. OVER edges from 2 through 5 have a saved 80–85% range; no interpolation within the range is invented.
7. Other eligible ranges retain their side and show that base confidence was not recorded.

The old sub-104 defensive filter remains removed. Current DE informs the reconstructed pace formula without reintroducing that eligibility filter.

The notes did not explicitly define combined-versus-per-team injuries, whether both SOS ratings must be positive, range endpoints, or sub-1.5 handling under PACE OVER. This implementation uses combined injuries, both-positive SOS, inclusive named ranges, and PACE OVER before edge filters. Those are explicit interpretation choices. Test files make the resulting behavior reviewable.

## Validation status and next data needed

Rule precedence, thresholds, season weights, missing observations, units, complete source joins, and future-date protection have automated tests. This does not establish betting profitability or predictive accuracy.

Calibrating the new season needs historical pregame features and outcomes: dated per-team snapshots, first-half closing/available lines with timestamps, pre-tipoff injuries, actual first-half totals, season, competition phase, and roster/coaching continuity. Final-season statistics may inform the following season but must never be used to predict earlier games within that completed season.

Use walk-forward evaluation by date and a held-out season to select prior strength, regression, formula coefficients, and regular/tournament intercepts. Report MAE, calibration where a probability is actually fitted, coverage, push handling, and results by early/mid/late season. The original March tracker and historical lines were not recovered; no backtest results are fabricated.
