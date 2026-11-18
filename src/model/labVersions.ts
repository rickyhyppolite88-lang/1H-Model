export const featurePaperMethods = [
  "opponent-paper-v5",
  "shooting-paper-v6",
] as const;
export type FeaturePaperMethod = (typeof featurePaperMethods)[number];
export const isFeaturePaperMethod = (id: string): id is FeaturePaperMethod =>
  featurePaperMethods.some((method) => method === id);
export const allForecastPaperMethods = [
  ...featurePaperMethods,
  "market-paper-v3",
  "referee-paper-v4",
] as const;
export const paperLabMethods = [
  "market-core-v3",
  "referee-core-v4",
  ...allForecastPaperMethods,
] as const;
export type PaperLabMethod = (typeof paperLabMethods)[number];
export const isPaperLabMethod = (id: string): id is PaperLabMethod =>
  paperLabMethods.some((method) => method === id);
export const isAllForecastPaperMethod = (id: string) =>
  allForecastPaperMethods.some((method) => method === id);
export const isRefereeLabMethod = (id: string) =>
  id === "referee-core-v4" || id === "referee-paper-v4";
export const isStakedLabStatus = (status: string) =>
  status === "qualified" || status === "paper_test";
export const paperLabPolicy = "lab-flat-paper-v1" as const;
