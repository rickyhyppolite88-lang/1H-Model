import { readFile, writeFile, mkdir, rename } from "node:fs/promises";

export async function loadPredictionRecord(model) {
  let index;
  try { index=model.recordIndexSchema.parse(JSON.parse(await readFile("public/data/prediction-record-index.json","utf8"))); }
  catch(error) {if(error.code==="ENOENT") return {schemaVersion:1,updatedAt:new Date().toISOString(),records:[],results:[]};throw error;}
  const records=new Map(); const results=new Map();
  for(const entry of index.archives) {
    const store=model.recordStoreSchema.parse(JSON.parse(await readFile(`public/${entry.jsonPath}`,"utf8")));
    for(const [items,map] of [[store.records,records],[store.results,results]]) for(const item of items) {
      if(map.has(item.id) && JSON.stringify(map.get(item.id))!==JSON.stringify(item)) throw new Error(`Conflicting immutable record ${item.id}`);
      map.set(item.id,item);
    }
  }
  return {schemaVersion:1,updatedAt:index.updatedAt,records:[...records.values()].sort((a,b) => a.recordedAt.localeCompare(b.recordedAt)||a.version-b.version),results:[...results.values()].sort((a,b) => a.observedAt.localeCompare(b.observedAt))};
}

export async function savePredictionRecord(model,store) {
  const index=model.buildRecordIndex(store);
  await mkdir("public/data/prediction-record",{recursive:true});
  for(const entry of index.archives) {
    const shard=model.recordForDate(store,entry.date);
    await writeFile(`public/${entry.jsonPath}.tmp`,`${JSON.stringify(shard,null,2)}\n`);
    await rename(`public/${entry.jsonPath}.tmp`,`public/${entry.jsonPath}`);
    await writeFile(`public/${entry.csvPath}`,`\uFEFF${model.recordToCsv(shard,index.canonicalIds)}`);
    const daily=model.dailyRecordGames(shard.records,index.canonicalIds);
    await writeFile(`public/${entry.gamesCsvPath}`,`\uFEFF${model.recordToCsv({...shard,records:daily},index.canonicalIds)}`);
  }
  await writeFile("public/data/prediction-record.csv",`\uFEFF${model.recordToCsv(store,index.canonicalIds)}`);
  await writeFile("public/data/prediction-record-index.json.tmp",`${JSON.stringify(index,null,2)}\n`);
  await rename("public/data/prediction-record-index.json.tmp","public/data/prediction-record-index.json");
  const ids=new Set(index.canonicalIds);
  const decorate=(r)=>({...r,...model.recordGrade(r,store.results),counted:ids.has(r.id),coverageStatus:model.dailyRecordStatus(r,ids)});
  return {index,payload:{...store,summary:index.summary,dailyCoverage:index.archives.map((a)=>({date:a.date,...a.coverage})),dailyGames:model.dailyRecordGames(store.records,index.canonicalIds).map(decorate),records:store.records.map(decorate)}};
}
