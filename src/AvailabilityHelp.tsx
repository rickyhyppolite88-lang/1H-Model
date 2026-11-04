export default function AvailabilityHelp() {
  return (
    <aside
      className="availability-help"
      aria-label="Understanding unavailable games"
    >
      <p>
        <strong>Missing inputs mean a data gap.</strong> These games are unrated
        and excluded from the official win/loss record.
      </p>
      <details>
        <summary>What is missing, and what can the model tell me?</summary>
        <dl>
          <dt>Projection data gap</dt>
          <dd>
            A team’s stats are outside coverage or could not be matched, or the
            game has no valid pregame stats snapshot. No model total or
            qualified model pick is available. The reason appears on that game’s
            row.
          </dd>
          <dt>Sportsbook line missing / Not posted</dt>
          <dd>
            A model total may be available, but that sportsbook’s first-half
            line was absent from the latest retrieved update. There is no
            over/under edge to compare yet. This does not imply a negative model
            signal.
          </dd>
          <dt>Signal unavailable</dt>
          <dd>
            The signal ranking needs a valid pregame projection, its scoring and
            pace components, and the selected sportsbook line. If any is
            missing, the signal stays neutral.
          </dd>
          <dt>Historical estimate</dt>
          <dd>
            The estimate was first available after tipoff. It can be reviewed,
            but it does not count as a recorded pregame pick.
          </dd>
        </dl>
      </details>
    </aside>
  );
}
