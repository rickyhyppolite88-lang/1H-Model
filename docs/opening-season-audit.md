# Opening-season audit — November 2, 2026

The first eight comparable completed first halves show that this reconstructed model should not inherit tournament confidence labels in regular-season games. The numeric coefficients and season weights remain unchanged. Regular-season output is now a research lean, without the old LOCK/PACE OVER confidence labels or betting filters.

## Initial replay

The initial archive had 184 ESPN events for November 1–2, with 14 completed first halves, including games still in their second half. Eight had a BetMGM first-half opener and usable model priors. Six completed halves were excluded because of unavailable markets or model coverage. Later refreshes can increase these counts.

| Matchup | BetMGM 1H opener | Model | Actual 1H | Legacy replay |
| --- | ---: | ---: | ---: | --- |
| Notre Dame / Villanova | 68.5 | 71.86 | 66 | OVER, loss |
| Liberty / High Point | 73.5 | 75.73 | 71 | OVER, loss |
| Northern Illinois / Grambling | 72.5 | 67.69 | 79 | UNDER, loss |
| Merrimack / App State | 66.5 | 67.92 | 64 | Not selected |
| Winthrop / Queens | 81.5 | 76.90 | 93 | UNDER, loss |
| Murray State / Tennessee State | 80.5 | 75.09 | 81 | UNDER, loss |
| UTEP / Northern Kentucky | 72.5 | 71.53 | 80 | Not selected |
| UTSA / San José State | 73.5 | 70.18 | 72 | UNDER, win |

Model MAE: **7.2659 points**. Opener MAE: **4.3750 points**. Bias (projection minus actual): **−3.6375 points**. The legacy filter replay is **1–5**, with two unselected games and no pushes. Missing injury snapshots mean this filter replay assumes zero injuries. It is not an actual betting record.

Actual totals ranged from 64 to 93, with mean 75.75 and median 75.5. Model totals ranged from 67.69 to 76.90, with mean 72.11 and median 71.69. All eight are season-debut reconstructions using the previous season's frozen final statistics and documented regression. None is a forecast stored before tipoff, and no current-game observation enters its projection.

## Changes and limits

The app now compares a fixed book's opener against true period-1 results, reports coverage and errors, and distinguishes the opener from an unverified latest quote. There is no fallback to a more favorable book. Raw quotes retain sources and capture timestamps. No latest quote is labeled a verified close because the source does not supply quote timestamps.

Future features are frozen with their actual creation time before tipoff. Postgame reconstructions are separately labeled. Repeat-team games without a genuine feature archive are excluded from replay. Markets/results refresh with team data at 11:20, 17:20, and 23:20 UTC in season.

Thirty comparable games is only a collection threshold for starting a walk-forward review. It does not certify that 30 observations support a reliable fit. No coefficient is fitted or promoted automatically. A numerical change must be fitted on earlier observations and evaluated on later observations against both the unchanged baseline and the market benchmark. The observed −3.64 bias is not automatically added to future projections.

## Sources and reproduction

Markets: [SportsbookReview November 1 first-half totals](https://www.sportsbookreview.com/betting-odds/ncaa-basketball/totals/1st-half/?date=2026-11-01) and [November 2](https://www.sportsbookreview.com/betting-odds/ncaa-basketball/totals/1st-half/?date=2026-11-02). Period results: [ESPN November 1 feed](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261101&groups=50&limit=1000) and [November 2 feed](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261102&groups=50&limit=1000). Exact quote and box-score URLs are retained per ledger game.

```sh
npm run markets:refresh
npm run audit:season
```

The audit invokes the app's actual TypeScript projection/rule functions. Outputs: `public/data/season-games.json` and `public/data/season-audit.json`. The default refresh backfills any gap since the last run and revisits recent days for completed results. It never overwrites an archived opener or feature snapshot with later observations.
