export const paperLabMethods = ["market-core-v3", "referee-core-v4"] as const;
export const isPaperLabMethod = (id: string) =>
  paperLabMethods.some((method) => method === id);
export const paperLabPolicy = "lab-flat-paper-v1" as const;
