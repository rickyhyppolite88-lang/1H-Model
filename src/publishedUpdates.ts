export const publishedRefreshMilliseconds = 30_000;

/** Recheck published snapshots while visible and immediately when the user returns. */
export function watchPublishedUpdates(refresh: () => unknown) {
  const visibleRefresh = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  const timer = window.setInterval(
    visibleRefresh,
    publishedRefreshMilliseconds,
  );
  window.addEventListener("focus", visibleRefresh);
  window.addEventListener("pageshow", visibleRefresh);
  document.addEventListener("visibilitychange", visibleRefresh);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", visibleRefresh);
    window.removeEventListener("pageshow", visibleRefresh);
    document.removeEventListener("visibilitychange", visibleRefresh);
  };
}
