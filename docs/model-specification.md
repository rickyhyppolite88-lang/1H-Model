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

## Historical tournament rule reconstruction and priority

1. Either blended OE below 0.96: NO BET, overriding all other tiers.
2. PACE OVER: absolute pace gap at least 5, both OE at least 1.05, and both current SOS ratings positive. This selects OVER with the saved 75% label regardless of model direction or edge filters. Three or more combined reported injuries block it.
3. Otherwise, model edge at least 8: NO BET. Edge below 1.5: NO BET. OVER with edge below 2: NO BET. Three or more combined injuries block any OVER.
4. LOCK: line strictly below 68, UNDER, and edge inclusively from 2 through 3. Saved label: 95%.
5. PRIME UNDER: UNDER edge inclusively 2–3 adds 15 to the historical rule label. A sub-68 UNDER adds 5; an UNDER pace gap inclusively 2–4 adds 5. The saved base confidence for ordinary PRIME UNDER was not recorded, so the app shows no invented numeric probability.
6. A 1.5-to-under-2 UNDER has a saved 70% base label; the recorded low-line and pace boosts can be added. OVER edges from 2 through 5 have a saved 80–85% range; no interpolation within the range is invented.
7. Other eligible ranges retain their side and show that base confidence was not recorded.

The old sub-104 defensive filter remains removed. Current DE informs the reconstructed pace formula without reintroducing that eligibility filter.

The notes did not explicitly define combined-versus-per-team injuries, whether both SOS ratings must be positive, range endpoints, or sub-1.5 handling under PACE OVER. This implementation uses combined injuries, both-positive SOS, inclusive named ranges, and PACE OVER before edge filters. Those are explicit interpretation choices. Test files make the resulting behavior reviewable.

## Research signal ranking and forecast preservation

`model-signal-v1` is a research ranking chosen while a calibrated hit model is unavailable. A pregame signal needs a valid captured projection, both components, and a line retrieved no later than the ranking time. Its score is `100 * abs(projection - line) / 8`, multiplied by 0.5 unless both components lean the same way as the combined total. Gaps of eight or more points are unranked for review. Missing/reconstructed/started games and pushes receive no green rank. This ranking does not change projection coefficients, apply the saved tournament tiers to regular games, or claim a per-game hit probability.

Forecast records preserve the prediction, frozen blended inputs, original book/basis/line, all captured quotes/prices, signal method/score/calculation time, recording time, and source revision. Updates append distinct versions when prediction inputs or pregame quotes change. Post-tipoff quote changes do not revise the pregame record. A changed post-tipoff numerical estimate is saved as historical. Result corrections are separate append-only events. Raw team datasets are archived by SHA-256; a run's latest raw data is never falsely labeled as an older game's frozen input snapshot.

The first eligible forecast per season, model version, benchmark book/basis, and game is canonical for performance. It must have been recorded before tipoff, use valid pregame features and an available retrieved quote, and have a non-push direction. Only completed period-one results can settle it. Later versions, missing predictions/lines, reconstructed estimates, and after-tipoff captures remain auditable but do not enter headline counts. Changed schedules await review. Pushes are excluded from the wins-plus-losses denominator; an empty denominator gives no win percentage.

Scores and outcomes remain independent: a loss does not retroactively change its recorded green score. Results by frozen score band provide evidence for later out-of-sample calibration. No numerical probability is automatically promoted from a small observed hit rate.

## Offense/defense carryover report

The team evaluation report adds dated first-half points allowed as an optional descriptive statistic. It is not part of `CompleteMetrics` and does not change the existing blend or projection weights. The TeamRankings importer now reads six tables; missing first-half defense does not disable otherwise complete core model inputs.

For the scoring breakdown, each team's estimate is `0.6 * its blended 1H scoring + 0.4 * expected_pace / 2 * expected_PPP`. In tournament context half the total suppression is allocated to each team. Their sum equals the existing combined projection. These team estimates are a decomposition of the reconstructed formula, not independently fitted forecasts.

The prior baseline uses zero current weight and the existing prior regression. Game comparisons use the frozen matchup features and never recompute completed-game predictions with the latest observed season statistics. Baseline/model MAE uses identical eligible games, with pregame and reconstructed cohorts kept separate. Team defense MAE grades the opponent scoring estimate against points conceded; it is distinct from the full-season defensive-efficiency statistic. Invalid features, incomplete halves, and missing scores are excluded, not assigned zero error. No betting line is required.

This is a carryover evaluation into the configured current season. A prior-season accuracy backtest would require archived pregame inputs/outcomes and is not represented by applying final-season statistics to earlier games.

## Validation status and next data needed

Rule precedence, thresholds, season weights, missing observations, units, complete source joins, and future-date protection have automated tests. This does not establish betting profitability or predictive accuracy.

Calibrating the new season needs historical pregame features and outcomes: dated per-team snapshots, first-half closing/available lines with timestamps, pre-tipoff injuries, actual first-half totals, season, competition phase, and roster/coaching continuity. Final-season statistics may inform the following season but must never be used to predict earlier games within that completed season.

Use walk-forward evaluation by date and a held-out season to select prior strength, regression, formula coefficients, and regular/tournament intercepts. Report MAE, calibration where a probability is actually fitted, coverage, push handling, and results by early/mid/late season. The original March tracker and historical lines were not recovered; no backtest results are fabricated.

## Regular-season policy update ? November 2, 2026

The saved tournament eligibility rules and confidence labels now apply only in tournament context. Regular-season output shows the raw model direction as **RESEARCH ONLY**, without a numeric probability. The initial eight-game market audit showed the reconstructed baseline trailing the opener benchmark; see [the audit](opening-season-audit.md). Numeric scoring weights and season-blend defaults remain unchanged because this sample does not establish a reliable new fit.

First-half results are imported from ESPN period 1 only after that period finishes. The selected book's opening first-half total is the fixed comparison market. Latest quotes have no verified close timestamp. Feature snapshots genuinely frozen before tipoff are separate from clearly labeled season-debut reconstructions; repeat-team games without valid pregame features are excluded. Thirty comparable observations is only a review threshold, never automatic model approval.
