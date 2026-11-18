import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";

export async function prepareFeatureResearch(server,{record,ledger,halves,excluded=[],directory="public",at}) {
  const {featureModelSchema}=await server.ssrLoadModule("/src/model/labFeatureSchema.ts");
  const {fitFeatureModel}=await server.ssrLoadModule("/src/model/labFeatures.ts");
  const {replayFeatureTrials}=await server.ssrLoadModule("/src/model/labFeatureReplay.ts");
  const {easternTipoff}=await server.ssrLoadModule("/src/model/time.ts");
  const {csvCell}=await server.ssrLoadModule("/src/model/predictions.ts");
  const save=async(path,value)=>{await writeFile(`${directory}/${path}.tmp`,value);await rename(`${directory}/${path}.tmp`,`${directory}/${path}`);};
  const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
  let model;
  try{model=featureModelSchema.parse(JSON.parse(await readFile(`${directory}/data/lab-feature-model.json`,"utf8")));}
  catch(error){if(error.code!=="ENOENT")throw error;}
  if(!model || model.date!==easternTipoff(at).date || model.season!==ledger.season)
    model=fitFeatureModel(halves,ledger.season,at,sha(JSON.stringify({halves,excluded})),excluded);
  if(Date.parse(model.fittedAt)>Date.parse(at))throw new Error("Cannot use future first-half feature model");
  const bytes=`${JSON.stringify(model,null,2)}\n`,path=`data/lab-feature-models/${sha(bytes)}.json`;
  await mkdir(`${directory}/data/lab-feature-models`,{recursive:true});
  try{await writeFile(`${directory}/${path}`,bytes,{flag:"wx"});}
  catch(error){if(error.code!=="EEXIST")throw error;if(await readFile(`${directory}/${path}`,"utf8")!==bytes)throw new Error("Immutable feature model mismatch");}
  await save("data/lab-feature-model.json",bytes);
  const {report,rows}=replayFeatureTrials(record,ledger,halves,at,excluded);
  await save("data/lab-feature-replay.json",`${JSON.stringify(report,null,2)}\n`);
  const keys=rows.length?Object.keys(rows[0]):["method","gameId","date"];
  await save("data/lab-feature-replay.csv",`\uFEFF${[keys,...rows.map(row=>keys.map(key=>row[key]))].map(row=>row.map(csvCell).join(",")).join("\r\n")}\r\n`);
  console.log(`Isolated Lab features: ${model.trainingGames} earlier halves; replay ${rows.length} paired method entries`);
  return {featureModel:model,featureModelPath:path};
}
