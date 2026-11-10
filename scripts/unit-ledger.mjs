import { readFile, writeFile, rename } from "node:fs/promises";

export async function updateUnitFiles(server, actual, lab, at, directory = "public") {
  const model = await server.ssrLoadModule("/src/model/units.ts");
  let previous = null;
  try { previous = model.unitLedgerSchema.parse(JSON.parse(await readFile(`${directory}/data/unit-ledger.json`, "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const ledger = model.updateUnitLedger(previous, actual, lab, at);
  await writeFile(`${directory}/data/unit-ledger.tmp`, `${JSON.stringify(ledger, null, 2)}\n`);
  await rename(`${directory}/data/unit-ledger.tmp`, `${directory}/data/unit-ledger.json`);
  const { canonicalRecords } = await server.ssrLoadModule("/src/model/predictionRecord.ts");
  const { canonicalLabForecasts } = await server.ssrLoadModule("/src/model/lab.ts");
  const actualPlays = canonicalRecords(actual.records,actual.entryPolicy).map((row) => model.actualUnitPlay(row, actual.results, ledger));
  const labPlays = canonicalLabForecasts(lab.forecasts,lab.entryPolicy).map((row) => model.labUnitPlay(row, lab, ledger));
  const results = model.unitResultsSchema.parse({schemaVersion:1, updatedAt:at, plays:[...actualPlays,...labPlays]});
  await writeFile(`${directory}/data/unit-results.tmp`, `${JSON.stringify(results)}\n`);
  await rename(`${directory}/data/unit-results.tmp`, `${directory}/data/unit-results.json`);
  for (const [name, plays] of [["actual", actualPlays], ["lab", labPlays]]) {
    await writeFile(`${directory}/data/${name}-units.csv`, `\uFEFF${model.unitPlaysCsv(plays.filter(model.hasUnitStake))}`);
  }
  console.log(`Units: ${ledger.assignments.length} immutable pregame stake snapshots; one frozen entry per game, historical replay separate`);
  return ledger;
}
