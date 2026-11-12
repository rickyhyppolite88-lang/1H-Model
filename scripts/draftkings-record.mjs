import { mkdir, writeFile, rename } from "node:fs/promises";

export async function saveDraftKingsRecord(server, actual, ledger, at, directory = "public") {
  const { draftKingsRecord, draftKingsRecordIndex } = await server.ssrLoadModule("/src/model/draftKingsRecord.ts");
  const model = await server.ssrLoadModule("/src/model/predictionRecord.ts");
  const units = await server.ssrLoadModule("/src/model/units.ts");
  const store = draftKingsRecord(actual, at);
  const index = draftKingsRecordIndex(store);
  const write = async (path, content) => {
    await writeFile(`${directory}/${path}.tmp`, content);
    await rename(`${directory}/${path}.tmp`, `${directory}/${path}`);
  };
  await mkdir(`${directory}/data/prediction-record-draftkings`, { recursive: true });
  for (const archive of index.archives) {
    const shard = model.recordForDate(store, archive.date);
    await write(archive.jsonPath, `${JSON.stringify(shard)}\n`);
    const csv = `\uFEFF${model.recordToCsv(shard, index.canonicalIds)}`;
    await write(archive.csvPath, csv);
    if (archive.gamesCsvPath) await write(archive.gamesCsvPath, csv);
  }
  const ids = new Set(index.canonicalIds);
  const plays = store.records.filter(row => ids.has(row.id)).map(row => units.actualUnitPlay(row, store.results, ledger));
  await write("data/unit-results-draftkings.json", `${JSON.stringify(units.unitResultsSchema.parse({schemaVersion:1,updatedAt:at,plays}))}\n`);
  await write("data/actual-units-draftkings.csv", `\uFEFF${units.unitPlaysCsv(plays.filter(units.hasUnitStake))}`);
  await write("data/prediction-record-draftkings.csv", `\uFEFF${model.recordToCsv(store,index.canonicalIds)}`);
  await write("data/prediction-record-draftkings-index.json", `${JSON.stringify(index,null,2)}\n`);
  console.log(`DraftKings calendar: ${plays.filter(units.hasUnitStake).length} staked entries, ${store.records.filter(row=>row.replay).length} labeled archive replays`);
  return {store,index,plays};
}
