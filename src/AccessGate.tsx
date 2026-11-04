import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import ThemeToggle from "./ThemeToggle";

export const accessSessionKey = "1h-model-access-v1";
export const idleTimeout = 30 * 60 * 1000;
export const accessPasswordDigest =
  "68a242c130a1c9254dbd2bb44ab18d787c40dc13eae775b103e086ccf17ce3a3";
const LockContext = createContext<() => void>(() => {});
export const useAppLock = () => useContext(LockContext);

export function sessionIsActive(at: number | null, now = Date.now()) {
  return (
    at !== null &&
    Number.isFinite(at) &&
    at > 0 &&
    at <= now &&
    now - at < idleTimeout
  );
}

function readSession(): number | null {
  try {
    const raw = localStorage.getItem(accessSessionKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

export async function verifyAccessPassword(password: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password),
  );
  return (
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("") === accessPasswordDigest
  );
}

/** A browser screen lock for the public Pages app; not server authorization. */
export default function AccessGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() =>
    sessionIsActive(readSession()),
  );
  const lastActive = useRef<number | null>(readSession());
  const lastWritten = useRef(0);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const saveSession = useCallback(() => {
    lastWritten.current = Date.now();
    try {
      if (lastActive.current !== null)
        localStorage.setItem(
          accessSessionKey,
          JSON.stringify(lastActive.current),
        );
    } catch {
      // The current tab still works when browser storage is disabled.
    }
  }, []);
  const lock = useCallback((reason = "") => {
    lastActive.current = null;
    setUnlocked(false);
    setPassword("");
    setError("");
    setMessage(reason);
    try {
      localStorage.removeItem(accessSessionKey);
    } catch {
      /* Session is cleared in memory. */
    }
  }, []);
  const manualLock = useCallback(
    () => lock("App locked. Sign in to continue."),
    [lock],
  );

  useEffect(() => {
    if (!unlocked) return;
    const expire = () =>
      lock("Your session timed out after 30 minutes of inactivity.");
    const check = () => {
      if (!sessionIsActive(lastActive.current)) expire();
    };
    const activity = () => {
      if (!sessionIsActive(lastActive.current)) {
        expire();
        return;
      }
      lastActive.current = Date.now();
      if (Date.now() - lastWritten.current >= 5000) saveSession();
    };
    const resume = () => {
      check();
      if (
        document.visibilityState === "visible" &&
        sessionIsActive(lastActive.current)
      )
        activity();
    };
    const visibility = () =>
      document.visibilityState === "hidden" ? saveSession() : resume();
    const storage = (event: StorageEvent) => {
      if (event.key !== accessSessionKey && event.key !== null) return;
      const at = readSession();
      if (sessionIsActive(at)) lastActive.current = at;
      else lock("App locked. Sign in to continue.");
    };
    resume();
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "scroll",
      "touchstart",
    ];
    for (const event of events)
      window.addEventListener(event, activity, { passive: true });
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", saveSession);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(check, 15000);
    return () => {
      for (const event of events) window.removeEventListener(event, activity);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", saveSession);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
      window.clearInterval(timer);
    };
  }, [unlocked, lock, saveSession]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const entered = password;
    setPassword("");
    setBusy(true);
    setError("");
    try {
      if (!(await verifyAccessPassword(entered))) {
        setError("Incorrect password. Try again.");
        return;
      }
      lastActive.current = Date.now();
      saveSession();
      setMessage("");
      setUnlocked(true);
    } catch {
      setError(
        "The password could not be checked. Open the site using HTTPS and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) return <LockContext value={manualLock}>{children}</LockContext>;
  return (
    <main className="access-page">
      <div className="access-theme">
        <ThemeToggle />
      </div>
      <section className="access-card" aria-labelledby="access-heading">
        <span className="brand-mark">1H</span>
        <span className="eyebrow">COLLEGE BASKETBALL</span>
        <h1 id="access-heading">Welcome back.</h1>
        <p>Sign in to open your first-half model.</p>
        {message && <output className="access-message">{message}</output>}
        <form onSubmit={signIn}>
          <label htmlFor="access-password">Password</label>
          <input
            id="access-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            disabled={busy}
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "access-error" : undefined}
          />
          {error && (
            <p id="access-error" className="access-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="access-footnote">
          Your view stays saved on this device. The app locks after 30 minutes
          of inactivity.
        </p>
      </section>
    </main>
  );
}
