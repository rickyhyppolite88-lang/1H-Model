import type { FoulExposure } from "./model/foulExposure";

export default function FoulDetails({
  forecast,
  away,
  home,
  actualFTA,
  actualFouls,
}: {
  forecast: FoulExposure | undefined;
  away: string;
  home: string;
  actualFTA: number | null;
  actualFouls: number | null;
}) {
  if (!forecast) return null;
  return (
    <div className="context-details">
      <p>
        <strong>Free throws & foul-call research</strong>
      </p>
      <p>
        {away}: {forecast.expectedAwayFTA.toFixed(1)} FT attempts (model range{" "}
        {forecast.awayFTALow}–{forecast.awayFTAHigh});{" "}
        {forecast.expectedAwayFouls.toFixed(1)} logged fouls (range{" "}
        {forecast.awayFoulLow}–{forecast.awayFoulHigh}). Estimated chance of 7+
        logged fouls: {(forecast.awaySevenFoulProbability * 100).toFixed(0)}%.
      </p>
      <p>
        {home}: {forecast.expectedHomeFTA.toFixed(1)} FT attempts (model range{" "}
        {forecast.homeFTALow}–{forecast.homeFTAHigh});{" "}
        {forecast.expectedHomeFouls.toFixed(1)} logged fouls (range{" "}
        {forecast.homeFoulLow}–{forecast.homeFoulHigh}). Estimated chance of 7+
        logged fouls: {(forecast.homeSevenFoulProbability * 100).toFixed(0)}%.
      </p>
      <p>
        Actual combined FT attempts: {actualFTA ?? "Pending"} · actual logged
        fouls: {actualFouls ?? "Pending"}.
      </p>
      <p>
        Central 80% model ranges and uncalibrated count probabilities—not
        betting hit percentages. Logged nontechnical fouls approximate official
        team fouls; referee assignments and individual referee call rates are
        not measured.
      </p>
      <p>
        {forecast.leagueGames} earlier D1 halves · team histories{" "}
        {forecast.awayHistoryGames} / {forecast.homeHistoryGames}, shrunk with
        four league pseudo-games. FT points change only for the matchup
        deviation; a second bonus-points adjustment is not added.
      </p>
    </div>
  );
}
