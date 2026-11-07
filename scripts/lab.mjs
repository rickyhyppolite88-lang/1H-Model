import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises";
import {createHash} from "node:crypto";

export async function updateLabFiles(server, { feed, ledger, prior, priorPath, results, directory = "public" }) {
  const model = await server.ssrLoadModule("/src/model/lab.ts");
  const { labComponentsToCsv } = await server.ssrLoadModule("/src/model/labComponents.ts");
  const { captureLab } = await server.ssrLoadModule("/src/model/labCapture.ts");
  const { datasetSchema } = await server.ssrLoadModule("/src/model/schema.ts");
  const read = async (path) => JSON.parse(await readFile(`${directory}/${path}`, "utf8"));
  const save = async (path, value, json = true) => {
    await writeFile(`${directory}/${path}.tmp`, json ? `${JSON.stringify(value, null, 2)}\n` : value);
    await rename(`${directory}/${path}.tmp`, `${directory}/${path}`);
  };
  const config = model.labConfigSchema.parse(await read("data/lab-config.json"));
  const at = new Date().toISOString();
  let contextModel,contextModelPath;
  try {
    const {contextModelSchema,gameContextIndexSchema}=await server.ssrLoadModule("/src/model/gameContext.ts");
    try {
      const metadata=gameContextIndexSchema.parse(await read("data/game-contexts.json"));
      const byId=new Map(metadata.games.map(game=>[game.gameId,game]));
      ledger={...ledger,games:ledger.games.map(game=>{
        const entry=byId.get(game.id);
        return entry&&Date.parse(entry.startsAt)===Date.parse(game.startsAt)&&entry.awayEspnId===game.away.espnId&&entry.homeEspnId===game.home.espnId&&(!game.contextRetrievedAt||Date.parse(entry.contextRetrievedAt)>Date.parse(game.contextRetrievedAt)) ? {...game,context:entry.context,contextRetrievedAt:entry.contextRetrievedAt} : game;
      })};
    }catch(error){if(error.code!=="ENOENT")throw error;}
    contextModel=contextModelSchema.parse(await read("data/context-model.json"));
    const bytes=`${JSON.stringify(contextModel,null,2)}\n`;
    const hash=createHash("sha256").update(bytes).digest("hex");
    contextModelPath=`data/context-models/${hash}.json`;
    await mkdir(`${directory}/data/context-models`,{recursive:true});
    try {await writeFile(`${directory}/${contextModelPath}`,bytes,{flag:"wx"});}
    catch(error){if(error.code!=="EEXIST")throw error;if(await readFile(`${directory}/${contextModelPath}`,"utf8")!==bytes)throw new Error("Archived context model hash mismatch");}
  }catch(error){if(error.code!=="ENOENT")throw error;}
  let old = { schemaVersion: 1, startedAt: at, updatedAt: at, forecasts: [], results: [], halves: [] };
  let previousIndex;
  try { previousIndex = model.labIndexSchema.parse(await read("data/lab-index.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (previousIndex) {
    const index = previousIndex;
    old = model.mergeLabStores(await Promise.all(index.archives.map(async (entry) => model.labStoreSchema.parse(await read(entry.jsonPath)))), index.startedAt, index.updatedAt);
  }
  let raw = { halves: [], errors: [{ gameId: "unknown", reason: "Raw first-half collector has not run yet." }] };
  try { raw = model.labHalfStoreSchema.parse(await read("data/lab-halves.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const snapshots = [];
  for (const file of await readdir(`${directory}/data/input-snapshots`)) {
    if (!file.endsWith(".json")) continue;
    const path = `data/input-snapshots/${file}`;
    snapshots.push({ path, data: datasetSchema.parse(await read(path)) });
  }
  let store = captureLab(old, config, feed, ledger, { prior, priorPath, snapshots, halves: raw.halves, excludedHistoryGames: raw.errors.map((error) => error.gameId), contextModel,contextModelPath }, at);
  const ids = new Set(store.forecasts.map((row) => row.gameId));
  const merge = { ...store, forecasts: [], results: results.filter((result) => ids.has(result.gameId)), halves: raw.halves.filter((half) => ids.has(half.gameId)) };
  store = model.mergeLabStores([store, merge], store.startedAt, at);
  await mkdir(`${directory}/data/lab`, { recursive: true });
  const archives = [];
  for (const date of [...new Set(store.forecasts.map((row) => row.gameDate))].sort().reverse()) {
    const forecasts = store.forecasts.filter((row) => row.gameDate === date);
    const games = new Set(forecasts.map((row) => row.gameId));
    const shard = { ...store, forecasts, results: store.results.filter((result) => games.has(result.gameId)), halves: store.halves.filter((half) => games.has(half.gameId)) };
    const jsonPath = `data/lab/${date}.json`;
    const csvPath = `data/lab/${date}.csv`;
    await save(jsonPath, shard);
    await save(csvPath, `\uFEFF${model.labToCsv(shard)}`, false);
    await save(`data/lab/${date}-components.csv`, `\uFEFF${labComponentsToCsv(forecasts, shard)}`, false);
    archives.push({ date, jsonPath, csvPath, games: games.size });
  }
  const index = model.labIndexSchema.parse({ schemaVersion: 1, startedAt: store.startedAt, updatedAt: at, config, archives,
    methodStartedAt: Object.fromEntries(model.labMethodIds.flatMap((method) => {
      const first = store.forecasts.find((row) => row.methodId === method);
      return first ? [[method, first.recordedAt]] : [];
    })),
    rawCoverage: { games: model.latestHalves(raw.halves).length, errors: raw.errors.length },
    games: ledger.games.filter((game) => ids.has(game.id)).map((game) => ({ gameId: game.id, startsAt: game.startsAt, status: game.status, firstHalfComplete: game.firstHalfComplete })),
  });
  await save("data/lab-index.json", index);
  await save("data/lab-components.csv", `\uFEFF${labComponentsToCsv(store.forecasts, store)}`, false);
  console.log(`Lab: ${store.forecasts.length} saved observations, ${archives.length} dated archives; ${index.rawCoverage.games} reconciled raw halves, ${index.rawCoverage.errors} raw data gaps`);
  return { index, store };
}
