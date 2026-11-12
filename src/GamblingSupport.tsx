import { useEffect, useRef } from "react";

// Verified against https://www.ncpgambling.org/help-treatment/ on 2026-11-11.
export const gamblingHelpline = {
  name: "1-800-MY-RESET",
  number: "1-800-697-3738",
  phone: "tel:+18006973738",
  source: "https://www.ncpgambling.org/help-treatment/",
};

export default function GamblingSupport({
  onContinue,
}: {
  onContinue: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main
      className="gambling-support-page"
      aria-labelledby="gambling-support-heading"
    >
      <section className="gambling-support-content">
        <span className="gambling-support-kicker">GAMBLING SUPPORT</span>
        <h1 id="gambling-support-heading" ref={heading} tabIndex={-1}>
          Support is here if you need it.
        </h1>
        <p>If gambling is causing you concern, you can reach out for help.</p>
        <p>Call the U.S. National Problem Gambling Helpline:</p>
        <a className="gambling-support-number" href={gamblingHelpline.phone}>
          {gamblingHelpline.name}
          <span>{gamblingHelpline.number}</span>
        </a>
        <p>Confidential support is available 24 hours a day.</p>
        <button
          className="gambling-support-continue"
          type="button"
          onClick={onContinue}
        >
          Continue
        </button>
        <a
          className="gambling-support-resources"
          href={gamblingHelpline.source}
          target="_blank"
          rel="noreferrer"
        >
          Support resources
        </a>
      </section>
    </main>
  );
}
