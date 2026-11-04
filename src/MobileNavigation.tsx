import { useId, useRef, useState } from "react";

const shortcuts = [
  [
    "predictions",
    "Lines",
    "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z",
  ],
  ["record", "Full record", "M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm4 5h6m-6 4h6"],
  [
    "evaluation",
    "Teams",
    "M4 20v-3a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3M8 6a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
  ],
];

export default function MobileNavigation({
  active,
  sections,
  onSelect,
}: {
  active: string;
  sections: string[][];
  onSelect: (section: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const close = () => {
    dialog.current?.close();
    setOpen(false);
  };
  const select = (section: string) => {
    close();
    onSelect(section);
    document.querySelector("main")?.scrollIntoView?.({ block: "start" });
  };
  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {shortcuts.map(([value, label, path]) => (
          <button
            type="button"
            key={value}
            aria-current={active === value ? "page" : undefined}
            onClick={() => select(value)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={path} />
            </svg>
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-current={
            shortcuts.some(([value]) => value === active) ? undefined : "page"
          }
          onClick={() => {
            dialog.current?.showModal();
            setOpen(true);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          More
        </button>
      </nav>
      <dialog
        ref={dialog}
        className="section-menu"
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
      >
        <div className="section-menu-heading">
          <h2 id={titleId}>Model sections</h2>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="section-menu-links">
          {sections.map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-current={active === value ? "page" : undefined}
              onClick={() => select(value)}
            >
              {label}
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </dialog>
    </>
  );
}
