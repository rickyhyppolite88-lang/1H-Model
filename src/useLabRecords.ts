import { useEffect, useRef, useState } from "react";
import {
  type LabIndex,
  type LabStore,
  labIndexSchema,
  labStoreSchema,
  mergeLabStores,
} from "./model/lab";

export function useLabRecords(date: string) {
  const [index, setIndex] = useState<LabIndex | null>(null);
  const [indexError, setIndexError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    store: LabStore | null;
    error: string;
  } | null>(null);
  const cache = useRef(
    new Map<string, { revision: string; store: LabStore }>(),
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/lab-index.json?reload=${retry}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw new Error("Lab collection has not been published yet.");
        const next = labIndexSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setIndex(next);
          setIndexError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setIndexError(
            "The Lab index could not be refreshed. No experimental results are added to the Actual record.",
          );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [retry]);
  const key = `${index?.updatedAt ?? ""}:${date}:${retry}`;
  useEffect(() => {
    if (!index) return;
    const controller = new AbortController();
    const archives = index.archives.filter(
      (entry) => date === "all" || entry.date === date,
    );
    const load = async () => {
      try {
        const stores = await Promise.all(
          archives.map(async (entry) => {
            const cached = cache.current.get(entry.jsonPath);
            if (cached?.revision === index.updatedAt) return cached.store;
            const response = await fetch(
              `${import.meta.env.BASE_URL}${entry.jsonPath}`,
              { signal: controller.signal, cache: "no-store" },
            );
            if (!response.ok) throw new Error("A Lab archive is unavailable");
            const store = labStoreSchema.parse(await response.json());
            if (!controller.signal.aborted)
              cache.current.set(entry.jsonPath, {
                revision: index.updatedAt,
                store,
              });
            return store;
          }),
        );
        if (!controller.signal.aborted)
          setLoaded({
            key,
            store: mergeLabStores(stores, index.startedAt, index.updatedAt),
            error: "",
          });
      } catch {
        if (!controller.signal.aborted)
          setLoaded({
            key,
            store: null,
            error:
              "The selected Lab history could not be loaded completely. No partial record is shown.",
          });
      }
    };
    void load();
    return () => controller.abort();
  }, [index, date, key]);
  return {
    index,
    error: indexError || (loaded?.key === key ? loaded.error : ""),
    store: loaded?.key === key ? loaded.store : null,
    retry: () => setRetry((value) => value + 1),
  };
}
