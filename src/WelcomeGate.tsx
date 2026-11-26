import { type ReactNode, useEffect, useState } from "react";
import ThemeToggle from "./ThemeToggle";

export const welcomeSessionKey = "1h-model-welcome-v1";

export const isThanksgivingWelcome = (at = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at) === "2026-11-26";

function alreadyWelcomed() {
  try {
    return sessionStorage.getItem(welcomeSessionKey) === "seen";
  } catch {
    return false;
  }
}

function MissedShot({ thanksgiving }: { thanksgiving: boolean }) {
  return (
    <svg
      className="welcome-court"
      viewBox="0 0 480 300"
      role="img"
      aria-labelledby="welcome-shot-title welcome-shot-description"
    >
      <title id="welcome-shot-title">One more shot.</title>
      <desc id="welcome-shot-description">
        A player shoots a basketball. It clips the rim, misses the basket, and
        bounces back across the court.
        {thanksgiving && " He wears a turkey on his shirt for Thanksgiving."}
      </desc>
      <ellipse
        cx="244"
        cy="273"
        rx="204"
        ry="13"
        fill="currentColor"
        opacity=".05"
      />
      <path
        d="M35 269h410M276 269c-10-31 7-66 44-66h99"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity=".16"
      />
      <path
        d="M405 269V56"
        fill="none"
        stroke="var(--text-secondary)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <rect
        x="324"
        y="32"
        width="116"
        height="78"
        rx="5"
        fill="var(--surface-raised)"
        stroke="var(--text-secondary)"
        strokeWidth="3"
      />
      <rect
        x="350"
        y="67"
        width="50"
        height="35"
        fill="none"
        stroke="var(--accent-ink)"
        strokeWidth="3"
      />
      <path
        d="m346 116 10 38h27l10-38m-42 12h38m-34 13h30m-27-25 10 38m14-38-10 38"
        fill="none"
        stroke="var(--text-secondary)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".65"
      />
      <path
        className="welcome-rim"
        d="M342 113h53"
        stroke="#ed8744"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <ellipse
        cx="112"
        cy="267"
        rx="37"
        ry="6"
        fill="currentColor"
        opacity=".12"
      />
      <g className="welcome-player">
        <path
          d="m99 211-11 47m36-47 15 47"
          stroke="#bf845e"
          strokeWidth="15"
          strokeLinecap="round"
        />
        <path
          d="M78 261h20m36 0h21"
          stroke="var(--text-primary)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="m87 187 4 31h21l3-17 4 17h20l-5-31"
          fill="var(--text-primary)"
        />
        <path d="m97 135-13 54c11 9 41 10 54 0l-9-54Z" fill="var(--accent)" />
        <path
          d="m100 135 12 10 13-10m-33 48h40"
          fill="none"
          stroke="var(--on-accent)"
          strokeWidth="3"
          opacity=".45"
        />
        {thanksgiving ? (
          <g className="welcome-turkey">
            <ellipse
              cx="98"
              cy="158"
              rx="5"
              ry="12"
              fill="#a33925"
              transform="rotate(-45 98 158)"
            />
            <ellipse
              cx="104"
              cy="153"
              rx="5"
              ry="12"
              fill="#ffb33e"
              transform="rotate(-23 104 153)"
            />
            <ellipse cx="112" cy="152" rx="5" ry="12" fill="#be4a27" />
            <ellipse
              cx="120"
              cy="154"
              rx="5"
              ry="12"
              fill="#ffce65"
              transform="rotate(23 120 154)"
            />
            <ellipse
              cx="126"
              cy="159"
              rx="5"
              ry="12"
              fill="#a33925"
              transform="rotate(45 126 159)"
            />
            <ellipse cx="112" cy="167" rx="12" ry="13" fill="#673624" />
            <ellipse cx="116" cy="168" rx="6" ry="8" fill="#93502c" />
            <path
              d="m106 179-2 4m14-4 2 4"
              stroke="#643321"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M112 163v-7"
              stroke="#9a552f"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <circle cx="113" cy="153" r="6" fill="#b7753f" />
            <path d="m118 153 6 3-6 2Z" fill="#ffd06a" />
            <path
              d="M117 157q5 6 0 7"
              fill="none"
              stroke="#c63c32"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="115" cy="151" r="1.2" fill="#24190e" />
          </g>
        ) : (
          <text
            x="111"
            y="172"
            textAnchor="middle"
            fill="var(--on-accent)"
            fontSize="19"
            fontWeight="800"
          >
            1H
          </text>
        )}
        <path
          d="M104 128v12m17-12v12"
          stroke="#bf845e"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path d="M96 106v13a17 17 0 0 0 34 0v-13" fill="#d59b73" />
        <path
          d="M95 107c-5-21 33-26 36-4l-14-4-21 10Z"
          fill="var(--text-primary)"
        />
        <circle cx="119" cy="112" r="1.6" fill="#362820" />
        <path
          d="m121 122 5-1"
          stroke="#6e4530"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <g
          className="welcome-shooting-arms"
          fill="none"
          stroke="#d59b73"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m96 143-8-25 35-28m7 53 20-26-7-29" />
          <path d="m120 91 13-5m7 3 9-3" strokeWidth="5" />
        </g>
      </g>
      <g className="welcome-ball">
        <circle r="11" fill="#f59446" stroke="#643b24" strokeWidth="1.5" />
        <path
          d="M-11 0h22M0-11v22M-7-8C2-5 2 5-7 8M7-8C-2-5-2 5 7 8"
          fill="none"
          stroke="#643b24"
          strokeWidth="1.1"
        />
      </g>
      <path
        className="welcome-impact"
        d="m326 95-5-7m14 5 1-9m-16 20-9-2"
        fill="none"
        stroke="var(--accent-ink)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** One introduction per tab session; refreshing never resets the user's app preferences. */
export default function WelcomeGate({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(alreadyWelcomed);
  const [thanksgiving, setThanksgiving] = useState(isThanksgivingWelcome);
  useEffect(() => {
    if (!thanksgiving) return;
    const timer = window.setTimeout(
      () => setThanksgiving(false),
      Math.max(0, Date.parse("2026-11-27T05:00:00Z") - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [thanksgiving]);
  if (entered) return children;
  function enter() {
    try {
      sessionStorage.setItem(welcomeSessionKey, "seen");
    } catch {
      // Continue even if browser storage is unavailable.
    }
    setEntered(true);
  }
  return (
    <main
      className={`welcome-page${thanksgiving ? " welcome-thanksgiving" : ""}`}
      aria-labelledby="welcome-heading"
    >
      <header className="welcome-header">
        <div className="welcome-wordmark">
          <span className="brand-mark">1H</span>
          <span>
            MODEL<small>COLLEGE BASKETBALL</small>
          </span>
        </div>
        <ThemeToggle />
      </header>
      <section className="welcome-content">
        <span className="welcome-eyebrow">
          {thanksgiving ? "HAPPY THANKSGIVING" : "BACK ON THE COURT"}
        </span>
        <MissedShot thanksgiving={thanksgiving} />
        <h1 id="welcome-heading">
          Welcome back. <br />
          <span>We missed you.</span>
        </h1>
        <p>
          Your first-half model. Your research.
          <br />
          Pick up where you left off.
        </p>
        <button
          type="button"
          className="primary-button welcome-enter"
          onClick={enter}
        >
          Enter 1H Model <span aria-hidden="true">→</span>
        </button>
        <small className="welcome-note">
          Your saved views stay right where you left them.
        </small>
      </section>
      <footer className="welcome-footer">1H MODEL · ONE HALF AT A TIME</footer>
    </main>
  );
}
