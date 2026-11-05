import type { SeasonLedger } from "./audit";
import {
  type LabConfig,
  type LabForecast,
  type LabHalf,
  type LabStore,
  labForecastSchema,
  latestHalves,
} from "./lab";
import type { PredictionFeed, PredictionRow } from "./predictions";
import { predictionComparison } from "./predictions";
import { compareTotal } from "./predictor";
import type { SeasonDataset } from "./schema";
import { predictionSignal } from "./signals";
import { easternTipoff, tipoffState } from "./time";

export type LabInputs = {
  prior: SeasonDataset;
  priorPath: string;
  snapshots: { data: SeasonDataset; path: string }[];
  halves: LabHalf[];
  excludedHistoryGames?: string[];
};

function allowedInputs(
  game: SeasonLedger["games"][number],
  inputs: LabInputs,
  at: string,
) {
  const features = game.featureSnapshot;
  if (!features) return null;
  const prior = inputs.prior;
  if (
    prior.asOf !== features.priorAsOf ||
    Date.parse(prior.retrievedAt) > Date.parse(at)
  )
    return null;
  const teams = prior.teams.filter(
    (team) => team.gamesPlayed > 0 && team.firstHalfAllowed != null,
  );
  if (!teams.length) return null;
  const mean =
    teams.reduce((sum, team) => sum + (team.firstHalfAllowed ?? 0), 0) /
    teams.length;
  const current = inputs.snapshots.find(
    (snapshot) => snapshot.data.retrievedAt === features.statsRetrievedAt,
  );
  const values = [features.away, features.home].map((frozen) => {
    const old = prior.teams.find((team) => team.id === frozen.id);
    const base = frozen.priorAvailable ? old?.firstHalfAllowed : mean;
    if (base == null) return null;
    let recent = 0;
    if (frozen.currentWeight > 0) {
      if (
        !current ||
        Date.parse(current.data.retrievedAt) > Date.parse(at) ||
        current.data.asOf !== features.currentAsOf
      )
        return null;
      const observed = current.data.teams.find(
        (team) => team.id === frozen.id,
      )?.firstHalfAllowed;
      if (observed == null) return null;
      recent = observed;
    }
    return (
      (base * (1 - 0.35) + mean * 0.35) * (1 - frozen.currentWeight) +
      recent * frozen.currentWeight
    );
  });
  return values.every((value): value is number => value !== null)
    ? {
        away: values[0],
        home: values[1],
        priorMean: mean,
        currentPath: current?.path ?? null,
      }
    : null;
}

/** Expected remaining minutes after the seventh event; not official bonus status. */
export function expectedBonusMinutes(fouls: number) {
  if (!Number.isFinite(fouls) || fouls < 0)
    throw new Error("Invalid foul rate");
  let integral = 0;
  for (let i = 0; i <= 200; i++) {
    const mu = (fouls * i) / 200;
    let term = 1;
    let sum = term;
    for (let k = 1; k <= 6; k++) {
      term *= mu / k;
      sum += term;
    }
    const tail = Math.max(0, Math.min(1, 1 - Math.exp(-mu) * sum));
    integral += tail * (i === 0 || i === 200 ? 0.5 : 1) * 0.1;
  }
  return integral;
}

function bonusInputs(
  game: SeasonLedger["games"][number],
  halves: LabHalf[],
  at: string,
  season: string,
) {
  const history = latestHalves(halves, at).filter(
    (half) =>
      half.season === season &&
      half.gameId !== game.id &&
      Date.parse(half.startsAt) < Date.parse(game.startsAt),
  );
  const league = history.filter((half) => half.bothD1);
  if (!league.length) return null;
  const leagueFouls =
    league.reduce(
      (sum, half) => sum + half.teams.reduce((n, team) => n + team.fouls, 0),
      0,
    ) /
    (league.length * 2);
  if (leagueFouls <= 0) return null;
  const leagueBonus =
    league.reduce(
      (sum, half) =>
        sum + half.teams.reduce((n, team) => n + team.bonusMinutes, 0),
      0,
    ) / league.length;
  const counts: number[] = [];
  const rates = [game.away.espnId, game.home.espnId].map(
    (teamId, index, ids) => {
      const own = history.flatMap((half) =>
        half.teams.filter((team) => team.espnId === teamId),
      );
      const draws = history
        .filter((half) =>
          half.teams.some((team) => team.espnId === ids[1 - index]),
        )
        .flatMap((half) =>
          half.teams.filter((team) => team.espnId !== ids[1 - index]),
        );
      counts.push(own.length);
      const defense =
        (own.reduce((sum, team) => sum + team.fouls, 0) + 4 * leagueFouls) /
        (own.length + 4);
      const drawing =
        (draws.reduce((sum, team) => sum + team.fouls, 0) + 4 * leagueFouls) /
        (draws.length + 4);
      return (defense * drawing) / leagueFouls;
    },
  );
  return {
    minutes: rates.reduce((sum, rate) => sum + expectedBonusMinutes(rate), 0),
    baseline: leagueBonus,
    leagueFouls,
    leagueGames: league.length,
    awayGames: counts[0],
    homeGames: counts[1],
  };
}

function qualify(row: PredictionRow, at: string) {
  const comparison = predictionComparison(row, "betmgm", "latest");
  const signal = predictionSignal(row, "betmgm", "latest", at);
  if (row.projectedFirstHalfTotal === null)
    return {
      status: "data_gap" as const,
      reason: "No valid pregame model inputs.",
      strength: null,
    };
  if (comparison.line === null)
    return {
      status: "data_gap" as const,
      reason: "No current BetMGM first-half line in the captured source.",
      strength: null,
    };
  const edge = Math.abs(comparison.signedEdge ?? 0);
  const reasons = [
    edge < 1.5 ? "Edge below 1.5 points." : "",
    edge >= 8 ? "8+ point outlier review." : "",
    signal.label !== "Aligned"
      ? "Scoring and pace do not both agree with the lean."
      : "",
  ].filter(Boolean);
  return {
    status: reasons.length ? ("watch_only" as const) : ("qualified" as const),
    reason: reasons.length
      ? reasons.join(" ")
      : "Edge is at least 1.5 and below 8; both components agree.",
    strength: signal.score,
  };
}

/** New observations only before tipoff; existing Lab rows are never recalculated. */
export function captureLab(
  store: LabStore,
  config: LabConfig,
  feed: PredictionFeed,
  ledger: SeasonLedger,
  inputs: LabInputs,
  at: string,
): LabStore {
  if (
    Date.parse(at) < Date.parse(store.updatedAt) ||
    Date.parse(feed.generatedAt) > Date.parse(at)
  )
    throw new Error("Cannot backdate a Lab capture");
  const forecasts = [...store.forecasts];
  const games = new Map(ledger.games.map((game) => [game.id, game]));
  for (const row of feed.predictions) {
    const game = games.get(row.gameId);
    if (
      !game ||
      tipoffState(row, Date.parse(at)) !== "upcoming" ||
      row.actualFirstHalfTotal !== null
    )
      continue;
    const features = game.featureSnapshot;
    const baselineValid =
      row.featureKind === "captured_pregame" &&
      features != null &&
      Date.parse(features.capturedAt) <= Date.parse(at) &&
      row.featureCapturedAt === features.capturedAt &&
      (!features.statsRetrievedAt ||
        Date.parse(features.statsRetrievedAt) <= Date.parse(at));
    const market = row.markets.find((entry) => entry.sportsbook === "betmgm");
    if (market && Date.parse(market.capturedAt) > Date.parse(at)) continue;
    const sourceCheck = row.marketCoverage?.checkedAt ?? feed.marketCapturedAt;
    if (Date.parse(sourceCheck) > Date.parse(at)) continue;
    const staleMarket =
      Date.parse(at) - Date.parse(sourceCheck) > 45 * 60_000 ||
      (market !== undefined &&
        Date.parse(at) - Date.parse(market.capturedAt) > 45 * 60_000);
    const rawComparison = predictionComparison(row, "betmgm", "latest");
    const comparison = {
      ...rawComparison,
      line: staleMarket ? null : rawComparison.line,
    };
    const quote = game.quotes.find(
      (entry) => entry.sportsbook === "betmgm",
    )?.latest;
    for (const method of config.methods.filter((entry) => entry.enabled)) {
      let total = baselineValid ? row.projectedFirstHalfTotal : null;
      let simple = row.simpleTotal;
      let status: LabForecast["status"] = "data_gap";
      let reason = "No valid pregame model inputs.";
      let strength: number | null = null;
      let bonus: number | null = null;
      let bonusBaseline: number | null = null;
      const frozen: LabForecast["inputs"] = {
        baselineModelVersion: feed.modelVersion,
        baselineFeatureCapturedAt: features?.capturedAt ?? null,
        statsRetrievedAt: features?.statsRetrievedAt ?? null,
        priorSnapshot: inputs.priorPath,
        currentSnapshot:
          inputs.snapshots.find(
            (snapshot) =>
              snapshot.data.retrievedAt === features?.statsRetrievedAt,
          )?.path ?? null,
        sourceBoard: market?.source ?? null,
        quoteCapturedAt: market?.capturedAt ?? null,
        marketCheckedAt: row.marketCoverage?.checkedAt ?? feed.marketCapturedAt,
        lastSeenLine: rawComparison.line,
        marketFreshness: staleMarket
          ? "Stale; no usable Lab entry line"
          : "Source check within 45 minutes",
        awayCurrentWeight: features?.away.currentWeight ?? null,
        homeCurrentWeight: features?.home.currentWeight ?? null,
      };
      if (features)
        for (const side of ["away", "home"] as const)
          for (const metric of [
            "firstHalfPoints",
            "pace",
            "offensiveEfficiency",
            "defensiveEfficiency",
          ] as const)
            frozen[`${side}_${metric}`] = features[side][metric];
      if (method.id === "bonus-exposure-v1") {
        total = null;
        simple = null;
        const excluded = new Set(inputs.excludedHistoryGames ?? []);
        const estimates = bonusInputs(
          game,
          inputs.halves.filter((half) => !excluded.has(half.gameId)),
          at,
          feed.season,
        );
        if (estimates) {
          bonus = estimates.minutes;
          bonusBaseline = estimates.baseline;
          status = "measurement";
          reason =
            "Bonus-timing proxy only. No point adjustment or bet. Sparse early-season history is shrunk toward the league.";
          Object.assign(frozen, {
            historyAsOf: at,
            excludedHistoryGames: [...excluded].sort().join(";"),
            pseudoGames: 4,
            poissonSteps: 200,
            leagueFouls: estimates.leagueFouls,
            leagueGames: estimates.leagueGames,
            awayPriorHalves: estimates.awayGames,
            homePriorHalves: estimates.homeGames,
            leagueBonusMinutes: estimates.baseline,
          });
        } else
          reason =
            "No reconciled earlier D1 first halves were observed before this capture; bonus inputs are missing.";
      } else if (baselineValid) {
        if (method.id === "first-half-defense-v1") {
          const defense = allowedInputs(game, inputs, at);
          if (
            defense &&
            row.simpleTotal !== null &&
            row.paceAdjustedTotal !== null
          ) {
            simple = (row.simpleTotal + defense.away + defense.home) / 2;
            total = simple * 0.6 + row.paceAdjustedTotal * 0.4;
            Object.assign(frozen, {
              awayFirstHalfAllowed: defense.away,
              homeFirstHalfAllowed: defense.home,
              priorAllowedMean: defense.priorMean,
              priorLeagueRegression: 0.35,
              currentSnapshot: defense.currentPath,
            });
          } else {
            total = null;
            reason =
              "Frozen first-half defensive inputs are missing or cannot be matched to the original stats retrieval.";
          }
        }
        if (total !== null) {
          const candidate = {
            ...row,
            projectedFirstHalfTotal: total,
            simpleTotal: simple,
            markets: row.markets.map((entry) =>
              entry.sportsbook === "betmgm" && staleMarket
                ? { ...entry, latestLine: null }
                : entry,
            ),
          };
          const eligibility = qualify(candidate, at);
          status = eligibility.status;
          reason = staleMarket
            ? "The saved market check or quote is over 45 minutes old; waiting for a fresh source check."
            : eligibility.reason;
          strength = eligibility.strength;
          if (
            method.id === "baseline-control-v1" &&
            comparison.line !== null &&
            compareTotal(total, comparison.line).modelLean !== "PUSH"
          ) {
            status = "control";
            reason =
              "Unfiltered baseline research lean, captured for comparison; not a qualified bet.";
          }
        }
      }
      const previous = forecasts
        .filter(
          (entry) =>
            entry.season === feed.season &&
            entry.gameId === row.gameId &&
            entry.methodId === method.id,
        )
        .at(-1);
      if (previous && Date.parse(at) >= Date.parse(previous.startsAt)) continue;
      const candidate = {
        id: "pending",
        season: feed.season,
        methodId: method.id,
        gameId: row.gameId,
        gameDate: easternTipoff(row.startsAt).date,
        startsAt: row.startsAt,
        recordedAt: at,
        version: (previous?.version ?? 0) + 1,
        revision: feed.source.revision,
        awayTeam: row.awayTeam,
        homeTeam: row.homeTeam,
        sportsbook: "betmgm",
        line: comparison.line,
        overPrice: comparison.line !== null ? (quote?.overPrice ?? null) : null,
        underPrice:
          comparison.line !== null ? (quote?.underPrice ?? null) : null,
        total,
        baselineTotal: baselineValid ? row.projectedFirstHalfTotal : null,
        simpleTotal: simple,
        paceTotal: row.paceAdjustedTotal,
        side:
          total !== null && comparison.line !== null
            ? compareTotal(total, comparison.line).modelLean
            : null,
        signalStrength: strength,
        status,
        reason,
        bonusMinutes: bonus,
        bonusBaselineMinutes: bonusBaseline,
        inputs: frozen,
      };
      const signature = (entry: typeof candidate | LabForecast) =>
        JSON.stringify({
          startsAt: entry.startsAt,
          line: entry.line,
          total: entry.total,
          baseline: entry.baselineTotal,
          status: entry.status,
          reason: entry.reason,
          bonus: entry.bonusMinutes,
          bonusBaseline: entry.bonusBaselineMinutes,
          overPrice: entry.overPrice,
          underPrice: entry.underPrice,
        });
      if (previous && signature(candidate) === signature(previous)) continue;
      forecasts.push(
        labForecastSchema.parse({
          ...candidate,
          id: `${feed.season}_${method.id}_${row.gameId}_v${candidate.version}`,
        }),
      );
    }
  }
  return { ...store, updatedAt: at, forecasts };
}
