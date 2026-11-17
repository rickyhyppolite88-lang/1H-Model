import { type ReactNode, useEffect, useState } from "react";
import { verifyAdminEntry } from "./adminEntry";
import ThemeToggle from "./ThemeToggle";

export default function ConstructionGate({
  children,
}: {
  children: ReactNode;
}) {
  const [fragment, setFragment] = useState(() => window.location.hash);
  const [verified, setVerified] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setFragment(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    let current = true;
    void verifyAdminEntry(fragment).then(
      (allowed) => {
        if (current) setVerified(allowed ? fragment : null);
      },
      () => {
        if (current) setVerified(null);
      },
    );
    return () => {
      current = false;
    };
  }, [fragment]);
  if (verified && verified === fragment) return children;
  return (
    <main className="construction-page" aria-labelledby="construction-heading">
      <header className="construction-header">
        <div className="construction-brand">
          <span className="brand-mark">1H</span>
          <strong>MODEL</strong>
        </div>
        <ThemeToggle />
      </header>
      <section className="construction-content">
        <div className="construction-illustration" aria-hidden="true">
          <svg
            viewBox="0 0 320 240"
            fill="none"
            focusable="false"
            aria-hidden="true"
          >
            <ellipse
              cx="160"
              cy="224"
              rx="130"
              ry="9"
              fill="currentColor"
              opacity=".06"
            />
            <path
              d="M42 152h236v15H42zM58 167v53m204-53v53"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="m52 153 14 14m20-14 14 14m20-14 14 14m20-14 14 14m20-14 14 14m20-14 14 14m20-14 14 14"
              stroke="#f2c14e"
              strokeWidth="11"
            />
            <path
              d="m132 177-4 42m42-42 6 42"
              stroke="#525b68"
              strokeWidth="18"
              strokeLinecap="round"
            />
            <path
              d="M119 221h17m34 0h18"
              stroke="currentColor"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d="M122 111c-5 10-8 25-7 42h66c1-18-1-31-8-42"
              fill="#f2c14e"
            />
            <path
              d="m126 114 11 39m30-39-11 39"
              stroke="#fff"
              strokeWidth="6"
            />
            <path
              d="m120 123-20 18-13-19m88 0 22 11 11-23"
              stroke="#d59c76"
              strokeWidth="12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="m207 109 6-30m-11 0h21m-14 0V66h10v13"
              stroke="#8f99a8"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path d="M128 81v13a21 21 0 0 0 42 0V81" fill="#e8b38d" />
            <path
              d="M119 81h59m-52-4a23 23 0 0 1 46 0"
              stroke="#f2c14e"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M149 53v22"
              stroke="#d79f28"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <path
              d="m145 97 7 1"
              stroke="#7a4b37"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="139" cy="87" r="2" fill="#43342d" />
            <circle cx="159" cy="87" r="2" fill="#43342d" />
            <path d="m51 222 12-33 12 33H51Z" fill="#f2c14e" />
            <path d="M57 207h12" stroke="#fff" strokeWidth="5" />
            <path
              d="M239 223h43m-36-7h30m-25-7h20"
              stroke="#f2c14e"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <path
              d="m239 59 4-9m18 24 10-2m-42-35-3-10"
              stroke="var(--accent-ink)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <span className="construction-status">
          <span />
          WORK IN PROGRESS
        </span>
        <h1 id="construction-heading">Under construction.</h1>
        <p>
          We’re putting the finishing touches on 1H Model.
          <br />
          Check back soon.
        </p>
        <div className="construction-progress" aria-hidden="true">
          <span />
        </div>
        <small>Good things take a little work.</small>
      </section>
      <footer className="construction-footer">
        1H MODEL · COLLEGE BASKETBALL
      </footer>
    </main>
  );
}
