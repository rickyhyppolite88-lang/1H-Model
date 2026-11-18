import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createServer} from "vite";

const output=process.argv[2]??".cache/lab-feature-backtest";
const server=await createServer({configFile:false,server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},appType:"custom"});
try {
  const read=async path=>JSON.parse(await readFile(`public/${path}`,"utf8"));
  const {mergeRecordStores}=await server.ssrLoadModule("/src/model/recordViews.ts");
  const {replayFeatureTrials}=await server.ssrLoadModule("/src/model/labFeatureReplay.ts");
  const {csvCell}=await server.ssrLoadModule("/src/model/predictions.ts");
  const index=await read("data/prediction-record-index.json");
  const record=mergeRecordStores(await Promise.all(index.archives.map(a=>read(a.jsonPath))),index.updatedAt);
  const ledger=await read("data/season-games.json"),raw=await read("data/lab-halves.json");
  const result=replayFeatureTrials(record,ledger,raw.halves,index.updatedAt,raw.errors.map(e=>e.gameId));
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/summary.json`,`${JSON.stringify(result.report,null,2)}\n`);
  const keys=result.rows.length?Object.keys(result.rows[0]):["method","gameId"];
  await writeFile(`${output}/games.csv`,`${[keys,...result.rows.map(row=>keys.map(key=>row[key]))].map(row=>row.map(csvCell).join(",")).join("\r\n")}\r\n`);
  console.log(JSON.stringify(result.report,null,2));
} finally {await server.close();}
