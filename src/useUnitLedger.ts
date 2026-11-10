import { useEffect, useState } from "react";
import {
  type UnitLedger,
  type UnitPlay,
  unitLedgerSchema,
  unitResultsSchema,
} from "./model/units";

export function useUnitLedger() {
  const [ledger, setLedger] = useState<UnitLedger | null>(null);
  const [plays, setPlays] = useState<UnitPlay[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [response, resultsResponse] = await Promise.all(
          ["unit-ledger.json", "unit-results.json"].map((name) =>
            fetch(`${import.meta.env.BASE_URL}data/${name}`, {
              signal: controller.signal,
              cache: "no-store",
            }),
          ),
        );
        if (!response.ok || !resultsResponse.ok)
          throw new Error("Unit ledger unavailable");
        const next = unitLedgerSchema.parse(await response.json());
        const results = unitResultsSchema.parse(await resultsResponse.json());
        if (next.updatedAt !== results.updatedAt)
          throw new Error("Unit files cover different refreshes");
        if (!controller.signal.aborted) {
          setLedger(next);
          setPlays(results.plays);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Unit stakes could not be refreshed. Any totals shown are from the last successful refresh.",
          );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  return { ledger, plays, error };
}
