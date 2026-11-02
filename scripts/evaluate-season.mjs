import { readFile, writeFile, rename } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
try {
  const { captureFeatures, evaluateSeason, ledgerSchema } = await server.ssrLoadModule("/src/model/audit.ts");
  const { datasetSchema } = await server.ssrLoadModule("/src/model/schema.ts");
  const read = async (path) => JSON.parse(await readFile(path, "utf8"));
  const ledger = ledgerSchema.parse(await read("public/data/season-games.json"));
  const prior = datasetSchema.parse(await read("public/data/prior-season.json"));
  const current = datasetSchema.parse(await read("public/data/current-season.json"));
  const enriched = captureFeatures(ledger, prior, current);
  const result = evaluateSeason(enriched);
  await writeFile("public/data/season-games.tmp", `${JSON.stringify(enriched, null, 2)}\n`);
  await rename("public/data/season-games.tmp", "public/data/season-games.json");
  await writeFile("public/data/season-audit.json", `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ sample: result.sample, completedHalves: result.completedHalves,
    modelMae: result.modelMae, marketMae: result.marketMae, modelBias: result.modelBias,
    legacyWins: result.legacyWins, legacyLosses: result.legacyLosses, prospective: result.prospective,
    status: result.calibrationStatus, excluded: result.excluded.length }, null, 2));
} finally { await server.close(); }
