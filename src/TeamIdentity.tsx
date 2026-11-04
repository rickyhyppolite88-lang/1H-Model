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
      <span className="team-mark" aria-hidden="true">
        {name
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")}
      </span>
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
