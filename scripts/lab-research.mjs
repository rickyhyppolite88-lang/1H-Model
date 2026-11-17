import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";

/** Fit once per Eastern date; publish an immutable parameter artifact and referee report. */
export async function prepareLabResearch(server, { record, ledger, halves, directory = "public", at }) {
  const model = await server.ssrLoadModule("/src/model/labResearch.ts");
  const refs = await server.ssrLoadModule("/src/model/referees.ts");
  const { easternTipoff } = await server.ssrLoadModule("/src/model/time.ts");
  const { csvCell } = await server.ssrLoadModule("/src/model/predictions.ts");
  const read = async (path) => JSON.parse(await readFile(`${directory}/${path}`, "utf8"));
  const save = async (path, content) => {
    await writeFile(`${directory}/${path}.tmp`, content);
    await rename(`${directory}/${path}.tmp`, `${directory}/${path}`);
  };
  let referees = { schemaVersion: 1, updatedAt: at, assignments: [], measurements: [], checks: [], errors: [] };
  try { referees = refs.refereeStoreSchema.parse(await read("data/referees.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  let fitted;
  try { fitted = model.researchModelSchema.parse(await read("data/lab-research-model.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const sha = (content) => createHash("sha256").update(content).digest("hex");
  if (!fitted || fitted.date !== easternTipoff(at).date) {
    fitted = model.fitResearchModel(record, ledger, halves, referees, at,
      sha(JSON.stringify({ record, halves })), sha(JSON.stringify(referees)));
  }
  if (Date.parse(fitted.fittedAt) > Date.parse(at)) throw new Error("Cannot use a future Lab model");
  const bytes = `${JSON.stringify(fitted, null, 2)}\n`;
  const path = `data/lab-research-models/${sha(bytes)}.json`;
  await mkdir(`${directory}/data/lab-research-models`, { recursive: true });
  try { await writeFile(`${directory}/${path}`, bytes, { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; if (await readFile(`${directory}/${path}`, "utf8") !== bytes) throw new Error("Immutable research model mismatch"); }
  await save("data/lab-research-model.json", bytes);
  const profiles = refs.summarizeReferees(referees, at, new Map()).map((profile) => {
    const frozen = fitted.refereeProfiles.find((r) => r.id === profile.id);
    return { ...profile, pricedGames: frozen?.pricedGames ?? 0, pointsAssociation: frozen?.pointsAssociation ?? 0 };
  });
  const report = refs.refereeReportSchema.parse({ schemaVersion: 1, updatedAt: at,
    modelFittedAt: fitted.fittedAt, measurements: refs.latestRefereeMeasurements(referees, at).length,
    sourceErrors: referees.errors.length, officials: profiles });
  await save("data/referee-report.json", `${JSON.stringify(report, null, 2)}\n`);
  const keys = Object.keys(refs.refereeMetricLabels);
  const csv = [["official_id", "official_name", "covered_first_halves", "priced_model_games", "shrunk_market_residual_points", ...keys.flatMap((key) => [key, `${key}_samples`])],
    ...profiles.map((p) => [p.id, p.name, p.games, p.pricedGames, p.pointsAssociation, ...keys.flatMap((key) => [p.metrics[key]?.mean ?? null, p.metrics[key]?.samples ?? 0])])]
    .map((row) => row.map(csvCell).join(",")).join("\r\n");
  await save("data/referee-research.csv", `\uFEFF${csv}\r\n`);
  console.log(`Lab research model: ${fitted.date}, ${fitted.trainingGames} earlier games; ${profiles.length} officials in observed first-half report`);
  return { researchModel: fitted, researchModelPath: path, referees };
}

export async function publishRefereeOutcomes(server, store, directory = "public") {
  let report;
  try { report = JSON.parse(await readFile(`${directory}/data/referee-report.json`, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const { refereeForecastResults } = await server.ssrLoadModule("/src/model/labResearchResults.ts");
  const { refereeReportSchema, refereeMetricLabels } = await server.ssrLoadModule("/src/model/referees.ts");
  const { csvCell } = await server.ssrLoadModule("/src/model/predictions.ts");
  const results = refereeForecastResults(store);
  report = refereeReportSchema.parse({ ...report, forecastTest: results.overall,
    officials: report.officials.map((profile) => ({ ...profile, forecastTest: results.officials[profile.id] ?? { games: 0, v3Brier: null, v4Brier: null, marketBrier: null, qualifiedWins: 0, qualifiedLosses: 0 } })) });
  await writeFile(`${directory}/data/referee-report.json.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  await rename(`${directory}/data/referee-report.json.tmp`, `${directory}/data/referee-report.json`);
  const keys = Object.keys(refereeMetricLabels);
  const header = ["official_id", "official_name", "covered_first_halves", "priced_model_games", "shrunk_market_residual_points", "v4_prospective_games", "matched_v3_brier", "v4_brier", "market_brier", "v4_qualified_wins", "v4_qualified_losses", ...keys.flatMap((k) => [k, `${k}_samples`])];
  const rows = report.officials.map((p) => [p.id, p.name, p.games, p.pricedGames, p.pointsAssociation,
    p.forecastTest.games, p.forecastTest.v3Brier, p.forecastTest.v4Brier, p.forecastTest.marketBrier, p.forecastTest.qualifiedWins, p.forecastTest.qualifiedLosses,
    ...keys.flatMap((k) => [p.metrics[k]?.mean ?? null, p.metrics[k]?.samples ?? 0])]);
  await writeFile(`${directory}/data/referee-research.csv.tmp`, `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`);
  await rename(`${directory}/data/referee-research.csv.tmp`, `${directory}/data/referee-research.csv`);
}
