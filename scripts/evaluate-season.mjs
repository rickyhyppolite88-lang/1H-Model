import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadPredictionRecord, savePredictionRecord } from "./prediction-record.mjs";

const server = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
try {
  const { captureFeatures, evaluateSeason, ledgerSchema } = await server.ssrLoadModule("/src/model/audit.ts");
  const { datasetSchema } = await server.ssrLoadModule("/src/model/schema.ts");
  const { generateTeamEvaluation, teamEvaluationToCsv } = await server.ssrLoadModule("/src/model/teamEvaluation.ts");
  const recordModel = await server.ssrLoadModule("/src/model/predictionRecord.ts");
  const { generatePredictions, predictionsToCsv, dailyPredictions, dailyArchiveSchema, updateDailyArchive, workbookPayload } = await server.ssrLoadModule("/src/model/predictions.ts");
  const read = async (path) => JSON.parse(await readFile(path, "utf8"));
  const ledger = ledgerSchema.parse(await read("public/data/season-games.json"));
  const prior = datasetSchema.parse(await read("public/data/prior-season.json"));
  const current = datasetSchema.parse(await read("public/data/current-season.json"));
  await mkdir("public/data/input-snapshots",{recursive:true});
  const preserveDataset=async(data) => {
    const bytes=`${JSON.stringify(data,null,2)}\n`;
    const sha=createHash("sha256").update(bytes).digest("hex");
    const path=`data/input-snapshots/${sha}.json`;
    try {await writeFile(`public/${path}`,bytes,{flag:"wx"});}
    catch(error) {if(error.code!=="EEXIST") throw error;if(await readFile(`public/${path}`,"utf8")!==bytes) throw new Error(`Archived input hash mismatch: ${sha}`);}
    return path;
  };
  const priorArchive=await preserveDataset(prior);
  const currentArchive=await preserveDataset(current);
  const enriched = captureFeatures(ledger, prior, current);
  const result = evaluateSeason(enriched);
  await writeFile("public/data/season-games.tmp", `${JSON.stringify(enriched, null, 2)}\n`);
  await rename("public/data/season-games.tmp", "public/data/season-games.json");
  await writeFile("public/data/season-audit.json", `${JSON.stringify(result, null, 2)}\n`);
  const revision=process.env.GITHUB_SHA??execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const predictions = generatePredictions(enriched, new Date().toISOString(), revision);
  await writeFile("public/data/predictions.json", `${JSON.stringify(predictions, null, 2)}\n`);
  await writeFile("public/data/predictions.csv", `\uFEFF${predictionsToCsv(predictions.predictions,predictions.defaultSportsbook,predictions.defaultLineBasis,predictions.generatedAt)}`);
  const oldRecord = await loadPredictionRecord(recordModel);
  const record = recordModel.updatePredictionRecord(oldRecord,predictions,enriched,predictions.generatedAt,{inputSnapshots:{prior:priorArchive,current:currentArchive,currentRetrievedAt:current.retrievedAt}});
  const recordOutput = await savePredictionRecord(recordModel,record);
  await mkdir(".cache/workbooks", { recursive: true });
  const workbook = async (feed, name, destination, builder = "scripts/build_prediction_workbook.py") => {
    const input = `.cache/workbooks/${name}.json`;
    await writeFile(input, JSON.stringify(builder === "scripts/build_prediction_workbook.py" ? workbookPayload(feed) : feed));
    execFileSync(process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3"), [builder, "--input", input, "--output", destination], { stdio: "inherit" });
  };
  await workbook(predictions, "all", "public/data/predictions.xlsx");
  await workbook(recordOutput.payload,"record","public/data/prediction-record.xlsx","scripts/build_record_workbook.py");
  const teamReport = generateTeamEvaluation(prior, current, enriched, predictions.generatedAt);
  await writeFile("public/data/team-evaluation.json", `${JSON.stringify(teamReport, null, 2)}\n`);
  await writeFile("public/data/team-comparison.csv", `\uFEFF${teamEvaluationToCsv(teamReport)}`);
  await workbook(teamReport, "teams", "public/data/team-comparison.xlsx", "scripts/build_team_workbook.py");
  let archive = { schemaVersion: 1, archives: [] };
  try { archive = dailyArchiveSchema.parse(await read("public/data/prediction-archive.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const daily = dailyPredictions(predictions);
  if (daily) {
    const directory = `public/data/daily/${daily.gameDate}`;
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/predictions.json`, `${JSON.stringify(daily, null, 2)}\n`);
    await writeFile(`${directory}/predictions.csv`, `\uFEFF${predictionsToCsv(daily.predictions,daily.defaultSportsbook,daily.defaultLineBasis,daily.generatedAt)}`);
    await workbook(daily, "daily", `${directory}/predictions.xlsx`);
    await writeFile(`${directory}/team-evaluation.json`, `${JSON.stringify(teamReport, null, 2)}\n`);
    await writeFile(`${directory}/team-comparison.csv`, `\uFEFF${teamEvaluationToCsv(teamReport)}`);
    await workbook(teamReport, "daily-teams", `${directory}/team-comparison.xlsx`, "scripts/build_team_workbook.py");
    archive = updateDailyArchive(archive, daily);
    console.log("Daily download:", daily.gameDate, JSON.stringify(daily.counts));
  } else console.log("Daily archive skipped: market data has not been refreshed for today's New York date.");
  await writeFile("public/data/prediction-archive.json", `${JSON.stringify(archive, null, 2)}\n`);
  console.log("Batch projections:", JSON.stringify(predictions.counts));
  console.log(JSON.stringify({ sample: result.sample, completedHalves: result.completedHalves,
    modelMae: result.modelMae, marketMae: result.marketMae, modelBias: result.modelBias,
    legacyWins: result.legacyWins, legacyLosses: result.legacyLosses, prospective: result.prospective,
    status: result.calibrationStatus, excluded: result.excluded.length }, null, 2));
} finally { await server.close(); }
