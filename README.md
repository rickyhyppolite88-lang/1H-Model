# 1H Model

College basketball first-half totals, rebuilt from the saved MADNESS v6.1 notes, with a new transition from the completed 2025–26 season into 2026–27.

The original Python repository and 63-game results tracker were not recovered. This is a documented reconstruction, not the original source or a claim to reproduce its historical performance.

## Run locally

Requires Node 22.12+ (Node 24 recommended). Python 3.10+ is needed only for data imports and importer tests.

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

Omit `--as-of` to use today's date. The importer reads five public dated tables, checks the selected date and season-column header, joins stable team links, and rejects partial or mismatched tables. It uses visible ratings rather than `data-sort` values, which can include a sorting offset. No paid/private data or keys are required.

The full prior snapshot is frozen at April 7, 2026. The initial current snapshot is November 2, 2026; only two teams have completed-game observations in that snapshot. The app displays its actual dates and warns on stale data. A source change or failed request fails the refresh rather than publishing invented or partial observations.

The workflow refreshes current data at 11:20 UTC during November–April. It validates before committing and deploying. A GitHub Actions bot commit does not trigger another workflow run; the same run deploys the refreshed data. New-season rollover is deliberate: update the season identifier and snapshot pair after the current season ends.

Public statistics: [TeamRankings college basketball](https://www.teamrankings.com/ncaa-basketball/). Every JSON snapshot records exact dated source URLs and retrieval time. The stat values use points per possession, not points per 100 possessions. Display precision follows the public source.

## Deploy on GitHub Pages

1. Push this source to `rickyhyppolite88-lang/1H-Model` on `main` using an account with write permission.
2. In **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
3. Let **Validate and deploy 1H Model** finish. The deployment's actual URL appears in the `github-pages` environment.

The expected repository Pages address is `https://rickyhyppolite88-lang.github.io/1H-Model/`, but it is not live until the first deployment succeeds. The workflow sets the repository base path; local development runs at `/`. [Vite's Pages instructions](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub's workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) describe the deployment mechanism.

All calculations run in the browser. The pick tracker uses local storage on that browser and does not sync between devices. Export records to retain a copy. Injuries and market lines are manual inputs; this version does not fetch live odds, injuries, or scheduled matchups.
