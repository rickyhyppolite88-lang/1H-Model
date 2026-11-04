import TeamJersey from "./TeamJersey";

export default function TeamIdentity({
  name,
  rank,
  conference,
}: {
  name: string;
  rank: number | null;
  conference: string | null;
}) {
  return (
    <strong className="matchup-team">
      <TeamJersey name={name} />
      <span className="team-name">
        {rank !== null && <span className="rank-badge">#{rank}</span>}
        {name}
        <span className="team-conference">
          {conference ?? "Conference unavailable"}
        </span>
      </span>
    </strong>
  );
}
