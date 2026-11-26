# November 26 public return audit

This audit freezes the published source at **November 26, 2026, 11:43 AM Eastern** (`2026-11-26T16:43:17.901Z`). Performance below covers completed November 18–25 games. Later live results can differ. [Machine-readable findings](relaunch-audit-2026-11-26.json) include sample sizes and matched controls.

## Decision and limits

Keep V6 shooting regression, V3 market benchmark and V4 referee paper trial collecting. Pause V5 and V2; preserve every archived method, forecast and result. Enforce a maximum of three collecting methods. These are the three highest flat-stake returns per unit risk in the recent samples, rather than three demonstrated profitable methods.

| Trial | Settled games | W–L | Net at flat 1u |
| --- | ---: | ---: | ---: |
| V6 shooting regression | 358 | 191–167 | −0.89u |
| V3 market benchmark | 366 | 194–172 | −3.38u |
| V4 referee paper trial | 226 | 118–108 | −4.55u |
| V5 previous-opponent correction | 358 | 186–172 | −10.31u |
| V2 combined factors | 60 | 31–29 | −2.30u |

The samples differ. V2's original −0.66u used only 43.5u of tiered risk; comparing that amount directly with the flat-stake trials would favor its smaller exposure. On the **42 games common to all five versions**, V5 was 23–19 (+0.85u), while V6, V3 and V4 were 22–20 (−0.95u each), and V2 was 22–20 (−1.03u). That small cohort does not support declaring a winner. Choosing retained trials from observed performance also introduces selection bias; confirmation requires future untouched games.

V6's matched Actual control lost 8.29u on the same 358 games and lines. V6 improved that sample by 7.41u, with point MAE 8.633 versus 8.663, but still lost money. Its average saved prices need roughly 53.5% winners to break even. A 191–167 record alone does not establish positive expected return. V3 and V4 retain Actual's numerical total and direction; their different overall records also reflect different coverage. Referee contribution must be assessed on matched games, not a comparison of unmatched headline records.

Actual's projection weights and numerical model stay fixed. New eligible Actual stakes become **flat 1u** when this release first updates the ledger; active paper trials remain flat 1u. The first update freezes `flatPolicyStartedAt`. Existing stake snapshots retain their original units and prices. DraftKings historical replays remain labeled and use the policy applicable at tipoff, without inventing pregame stakes. Raw research scores remain archived, but pick and record screens use **YES BET / NO BET and units**, without confidence percentages.

## Record and collection checks

- Parsed 9,338 official forecast versions, 41,544 Lab versions, 3,772 canonical Lab observations and 12,478 unit assignments. Independently recomputed Lab grading and settlement produced **zero mismatches**. There were zero duplicate stake IDs.
- The recorded Actual ledger and DraftKings calendar represent different populations. Recorded Actual in the recent window was **40–58, −17.38u on 67u risk**. The combined DraftKings calendar was **181–171, −6.18u**, combining 98 recorded plays and 254 labeled historical replays. Neither is an all-1u historical record. The accompanying JSON supplies separately calculated flat-stake comparisons without overwriting either record.
- Six recent games retain schedule-review holds after neutral-site home/away ordering and tip-time changes: 401917542, 401929445, 401924267, 401920414, 401911535 and 401911253. One older game, 401920952, also has changed conference context. These holds remain explicit; no result is fabricated or counted as settled.
- Today's source snapshot had 23 games, no missing numeric projections, and published DraftKings and BetMGM markets for all 23. Availability at capture is distinct from quote freshness. YES BET requires an upcoming game, captured pregame inputs, an available selected-book line, no more than 45 minutes of quote/check age, a numerical lean, and a gap below the existing 8-point review boundary. The official Actual entry still freezes its verified pre-tip snapshot. **Top 10 edges applies this same YES BET decision before ranking**, and never pads a short list with NO BET games.
- Existing five-minute schedule invocations and game-aware refresh planning remain in place. The browser checks publications every 30 seconds; a browser refresh does not create a newer sportsbook quote by itself.

## Phone performance and public entry

The full Lab record previously required **151,600,624 bytes** of JSON before compression. New display snapshots retain both each saved canonical entry and each latest observation, plus current results and raw halves. Across the frozen archive they total **14,194,288 bytes**, about 91% smaller. All 3,772 canonical entries and their grades match the originals. Every full original archive remains available to the collectors and audit tooling.

The original URL returns to the welcome → existing password → support notice → app flow. App data mounts after sign-in and acknowledgment. The welcome can be skipped immediately and is remembered per tab session. The missed-shot animation runs once and respects reduced motion. A corrected landscape backboard and turkey-shirt Thanksgiving artwork apply only on November 26 in Eastern Time, then automatically return to the regular green welcome.

Mobile Lab tabs and controls fit their containers, including narrow screens and enlarged text. Pick cards retain the four compact fields beside the teams, with tap-to-expand details. Desktop keeps the wider board. CSV, Excel and raw JSON download controls are removed from the app; collection archives remain intact. Theme, sportsbook and other view preferences still persist across refreshes.

## Forward test

Keep each component isolated, with fixed definitions and caps. Track W–L–P, net units at saved prices, coverage and paired-control point error. Review collection weekly. Evaluate only after **at least 30 days and 300 completed matched prospective games per method**, whichever takes longer. V6 has crossed the game threshold but has only about eight days in this sample. Do not tune on a bad day or promote a method from this selection sample; require a subsequent untouched period.
