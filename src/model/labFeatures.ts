import type { SeasonLedger } from "./audit";
import { type LabForecast, type LabHalf, latestHalves } from "./lab";
import {
  type FeatureModel,
  featureModelSchema,
  featureRules,
} from "./labFeatureSchema";
import { type FeaturePaperMethod, isStakedLabStatus } from "./labVersions";
import { marketStatus } from "./marketCoverage";
import type { PredictionFeed, PredictionRow } from "./predictions";
import { projectionSignal } from "./signals";
import { easternTipoff } from "./time";

const before = (value: string | null | undefined, at: string) =>
  !!value && Date.parse(value) <= Date.parse(at);
const possessions = (half: LabHalf) =>
  half.teams.reduce(
    (sum, team) =>
      sum +
      team.fga -
      team.offensiveRebounds +
      team.turnovers +
      0.475 * team.fta,
    0,
  ) / 2;

/** Frozen daily features. Same-day halves, later corrections and non-D1 games are excluded. */
export function fitFeatureModel(
  halves: LabHalf[],
  season: string,
  at: string,
  sourceHash: string,
  excluded: string[] = [],
): FeatureModel {
  const date = easternTipoff(at).date;
  const blocked = new Set(excluded);
  const history = latestHalves(halves, at).filter(
    (half) =>
      half.season === season &&
      half.bothD1 &&
      !blocked.has(half.gameId) &&
      easternTipoff(half.startsAt).date < date &&
      half.teams.length === 2 &&
      half.teams[0].espnId !== half.teams[1].espnId &&
      half.teams.every(
        (t) => t.threeMade <= t.threeAttempted && t.threeAttempted <= t.fga,
      ) &&
      possessions(half) >= 15 &&
      possessions(half) <= 60,
  );
  const observations = history.flatMap((half) =>
    half.teams.map((team, i) => ({
      id: team.espnId,
      opponent: half.teams[1 - i].espnId,
      points: team.points,
      poss: possessions(half),
      threeMade: team.threeMade,
      threeAttempted: team.threeAttempted,
    })),
  );
  const totalPoss = observations.reduce((s, t) => s + t.poss, 0);
  const leagueRate = totalPoss
    ? observations.reduce((s, t) => s + t.points, 0) / totalPoss
    : 0;
  const leaguePossessions = observations.length
    ? totalPoss / observations.length
    : 0;
  const attempts = observations.reduce((s, t) => s + t.threeAttempted, 0);
  const leagueThreeRate = attempts
    ? observations.reduce((s, t) => s + t.threeMade, 0) / attempts
    : 0;
  const groups = new Map<string, typeof observations>();
  const allowedGroups = new Map<string, typeof observations>();
  for (const row of observations) {
    groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
    allowedGroups.set(row.opponent, [
      ...(allowedGroups.get(row.opponent) ?? []),
      row,
    ]);
  }
  const offense = new Map([...groups.keys()].map((id) => [id, 0]));
  const defense = new Map(offense);
  const priorPoss = featureRules.opponentPriorHalves * leaguePossessions;
  for (let iteration = 0; iteration < featureRules.iterations; iteration++) {
    for (const [id, rows] of groups) {
      offense.set(
        id,
        rows.reduce(
          (s, t) =>
            s +
            t.points -
            t.poss * (leagueRate + (defense.get(t.opponent) ?? 0)),
          0,
        ) /
          (rows.reduce((s, t) => s + t.poss, 0) + priorPoss),
      );
    }
    // Every observation is an offense/opponent pair. Fit allowed efficiency to the same games.
    for (const id of groups.keys()) {
      const rows = allowedGroups.get(id) ?? [];
      defense.set(
        id,
        rows.reduce(
          (s, t) =>
            s + t.points - t.poss * (leagueRate + (offense.get(t.id) ?? 0)),
          0,
        ) /
          (rows.reduce((s, t) => s + t.poss, 0) + priorPoss),
      );
    }
  }
  const teams = Object.fromEntries(
    [...groups].map(([id, rows]) => {
      const poss = rows.reduce((s, t) => s + t.poss, 0),
        points = rows.reduce((s, t) => s + t.points, 0);
      const threeAttempted = rows.reduce((s, t) => s + t.threeAttempted, 0),
        threeMade = rows.reduce((s, t) => s + t.threeMade, 0);
      const rawOffenseRate =
        (points + priorPoss * leagueRate) / (poss + priorPoss);
      const adjustedOffenseRate = leagueRate + (offense.get(id) ?? 0);
      const rawThreeRate = threeAttempted ? threeMade / threeAttempted : null;
      const regressedThreeRate =
        (threeMade + featureRules.shootingPriorAttempts * leagueThreeRate) /
        (threeAttempted + featureRules.shootingPriorAttempts);
      return [
        id,
        {
          games: rows.length,
          possessions: poss,
          rawOffenseRate,
          adjustedOffenseRate,
          defenseOffset: defense.get(id) ?? 0,
          scheduleDeltaRate: adjustedOffenseRate - rawOffenseRate,
          threeMade,
          threeAttempted,
          rawThreeRate,
          regressedThreeRate,
          shootingDeltaRate:
            rawThreeRate === null
              ? 0
              : (3 * (regressedThreeRate - rawThreeRate) * threeAttempted) /
                poss,
        },
      ];
    }),
  );
  return featureModelSchema.parse({
    schemaVersion: 1,
    policy: "isolated-half-features-v1",
    season,
    date,
    fittedAt: at,
    sourceHash,
    trainingGames: history.length,
    latestObservedAt:
      history
        .map((h) => h.observedAt)
        .sort()
        .at(-1) ?? null,
    leagueRate,
    leaguePossessions,
    leagueThreeRate,
    rules: featureRules,
    teams,
  });
}

/** Change only the current-season share of Actual's historical-scoring branch. */
export function featureAdjustment(
  method: FeaturePaperMethod,
  model: FeatureModel,
  game: SeasonLedger["games"][number],
  modelPath: string,
) {
  const features = game.featureSnapshot;
  if (!features || model.trainingGames < featureRules.minimumLeagueGames)
    return null;
  const expectedPossessions = (features.away.pace + features.home.pace) / 4;
  if (!(expectedPossessions > 0)) return null;
  const teams = (["away", "home"] as const).map((side) => {
    const id = game[side].espnId,
      profile = model.teams[id];
    if (!profile || profile.games < featureRules.minimumTeamGames) return null;
    const deltaRate =
      method === "opponent-paper-v5"
        ? profile.scheduleDeltaRate
        : profile.shootingDeltaRate;
    return {
      espnId: id,
      games: profile.games,
      currentWeight: features[side].currentWeight,
      deltaRate,
      weightedPoints:
        featureRules.scoringWeight *
        features[side].currentWeight *
        expectedPossessions *
        deltaRate,
    };
  });
  if (!teams[0] || !teams[1]) return null;
  const unboundedAdjustment = teams[0].weightedPoints + teams[1].weightedPoints;
  return {
    policy: "isolated-half-features-v1" as const,
    selectionPolicy: "component-paper-v1" as const,
    modelPath,
    fittedAt: model.fittedAt,
    trainingGames: model.trainingGames,
    expectedPossessions,
    unboundedAdjustment,
    adjustment: Math.max(
      -featureRules.pointCap,
      Math.min(featureRules.pointCap, unboundedAdjustment),
    ),
    paperUnits: 0 as 0 | 1,
    away: teams[0],
    home: teams[1],
  };
}

export function captureFeatureForecast(
  method: FeaturePaperMethod,
  row: PredictionRow,
  game: SeasonLedger["games"][number],
  feed: PredictionFeed,
  model: FeatureModel | undefined,
  modelPath: string | undefined,
  at: string,
): LabForecast {
  const features = game.featureSnapshot;
  const validBaseline =
    row.featureKind === "captured_pregame" &&
    features &&
    features.away.id === game.away.modelId &&
    features.home.id === game.home.modelId &&
    row.featureCapturedAt === features.capturedAt &&
    before(features.capturedAt, at) &&
    (!features.statsRetrievedAt || before(features.statsRetrievedAt, at));
  const baseline = validBaseline ? row.projectedFirstHalfTotal : null;
  const quote = game.quotes.find((q) => q.sportsbook === "draftkings");
  const checkedAt = row.marketCoverage?.checkedAt ?? feed.marketCapturedAt;
  const fresh =
    quote &&
    before(quote.latestCapturedAt, at) &&
    before(checkedAt, at) &&
    Date.parse(at) - Date.parse(quote.latestCapturedAt) <= 45 * 60_000 &&
    Date.parse(at) - Date.parse(checkedAt) <= 45 * 60_000 &&
    marketStatus(row, "draftkings") === "available";
  const line = fresh ? (quote.latest?.total ?? null) : null;
  const validPrice = (n: number | null | undefined) =>
    n != null && Number.isFinite(n) && Math.abs(n) >= 100;
  const validModel =
    model &&
    modelPath &&
    model.season === feed.season &&
    model.date === easternTipoff(at).date &&
    before(model.fittedAt, at);
  const feature =
    baseline !== null && validModel
      ? featureAdjustment(method, model, game, modelPath)
      : null;
  const total =
    feature && baseline !== null
      ? Math.max(0, baseline + feature.adjustment)
      : null;
  const simple =
    row.simpleTotal !== null && feature
      ? row.simpleTotal + feature.adjustment / featureRules.scoringWeight
      : null;
  const rating = projectionSignal(
    {
      projectedFirstHalfTotal: total,
      simpleTotal: simple,
      paceAdjustedTotal: row.paceAdjustedTotal,
    },
    line,
  );
  const side =
    total !== null && line !== null
      ? total > line
        ? "OVER"
        : total < line
          ? "UNDER"
          : "PUSH"
      : null;
  let status: LabForecast["status"] = "data_gap",
    reason = "A frozen pregame core projection is required.";
  if (baseline !== null) {
    if (!validModel)
      reason = "Today's frozen first-half feature model is unavailable.";
    else if (!feature)
      reason =
        "At least 30 earlier D1 halves and one earlier half for each team are required.";
    else if (
      line === null ||
      !validPrice(quote?.latest?.overPrice) ||
      !validPrice(quote?.latest?.underPrice)
    )
      reason =
        "A fresh verified DraftKings line and both valid side prices are required.";
    else if (
      Date.parse(at) >= Date.parse(row.startsAt) ||
      row.actualFirstHalfTotal !== null
    )
      reason =
        "No paper entries can be captured after tipoff or a known result.";
    else if (rating.score === null) {
      status = "watch_only";
      reason = rating.reason;
    } else {
      status = "paper_test";
      reason =
        "Isolated component test: 1u paper on the latest usable pre-tip forecast. Saved confidence is a model score, not a win probability. No numerical weights are promoted to Actual.";
    }
  }
  if (feature) feature.paperUnits = isStakedLabStatus(status) ? 1 : 0;
  return {
    id: "pending",
    season: feed.season,
    methodId: method,
    gameId: row.gameId,
    gameDate: easternTipoff(row.startsAt).date,
    startsAt: row.startsAt,
    recordedAt: at,
    version: 1,
    revision: feed.source.revision,
    awayTeam: row.awayTeam,
    homeTeam: row.homeTeam,
    participants: { away: game.away, home: game.home },
    sportsbook: "draftkings",
    line,
    overPrice: fresh ? (quote.latest?.overPrice ?? null) : null,
    underPrice: fresh ? (quote.latest?.underPrice ?? null) : null,
    total,
    baselineTotal: baseline,
    simpleTotal: simple,
    paceTotal: row.paceAdjustedTotal,
    side,
    signalStrength: rating.score,
    status,
    reason,
    bonusMinutes: null,
    bonusBaselineMinutes: null,
    ...(feature ? { feature } : {}),
    inputs: {
      modelPolicy: "isolated-half-features-v1",
      selectionPolicy: "component-paper-v1",
      modelPath: modelPath ?? null,
      baselineFeatureCapturedAt: features?.capturedAt ?? null,
      statsRetrievedAt: features?.statsRetrievedAt ?? null,
      entryQuoteCapturedAt: quote?.latestCapturedAt ?? null,
      quoteCapturedAt: quote?.latestCapturedAt ?? null,
      marketCheckedAt: checkedAt,
      sourceBoard: quote?.source ?? null,
      historyAsOf: model?.fittedAt ?? null,
      opponentPriorHalves: 4,
      shootingPriorAttempts: 50,
      scoringWeight: 0.6,
      pointCap: 3,
      interpretation:
        method === "opponent-paper-v5"
          ? "Opponent-strength correction against equally shrunk unadjusted offense; pace/efficiency branch unchanged."
          : "Regress observed three-point conversion toward the earlier league rate while retaining attempt volume; pace/efficiency branch unchanged.",
    },
  };
}
