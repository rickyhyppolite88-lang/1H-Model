import { lazy, Suspense } from "react";
import AccessGate from "./AccessGate";
import WelcomeGate from "./WelcomeGate";

const App = lazy(() => import("./App"));

/** The original URL and existing bookmarks share the same welcome and sign-in flow. */
export default function AppEntry() {
  return (
    <WelcomeGate>
      <AccessGate>
        <Suspense
          fallback={
            <main className="app-opening">
              <h1>Opening your model…</h1>
            </main>
          }
        >
          <App />
        </Suspense>
      </AccessGate>
    </WelcomeGate>
  );
}
