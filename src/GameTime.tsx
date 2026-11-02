import { easternTipoff } from "./model/time";

export default function GameTime({ startsAt }: { startsAt: string }) {
  const value = easternTipoff(startsAt);
  return (
    <time
      className="game-time"
      dateTime={startsAt}
      title={`Eastern Time (${value.zone})`}
    >
      <span>{value.date}</span>
      <strong>{value.time} ET</strong>
    </time>
  );
}
