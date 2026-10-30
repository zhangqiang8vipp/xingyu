/**
 * Fail-closed preflight for the one-time AXIS / OAuth schema 27 production release.
 * No database writes occur in this file.
 */
import {readFileSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const ROOT=fileURLToPath(new URL("..",import.meta.url));
const NEW_MIGRATION="0025_oauth_connection_labels.sql";

function requireSafe(condition,reason){
  if(!condition)throw new Error("AXIS schema-27 release blocked: "+reason);
}
export function expectedMigrationFiles(root=ROOT){
  const files=readdirSync(path.join(root,"drizzle"))
    .filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
  requireSafe(files.length===26&&files[25]===NEW_MIGRATION,
    "only the exact 0025 additive migration is allowed");
  for(let i=0;i<files.length;i++)
    requireSafe(files[i].startsWith(String(i).padStart(4,"0")+"_"),
      "missing or out-of-order migration "+i);
  return files;
}
export function rowsFromD1(payload){
  const entries=Array.isArray(payload)?payload:[payload];
  requireSafe(entries.length>0&&entries.every(item=>item&&item.success!==false),
    "a remote D1 query failed");
  const queue=[...entries],rows=[];
  while(queue.length){
    const item=queue.shift();
    if(!item||typeof item!=="object")continue;
    if(Array.isArray(item.results))rows.push(...item.results);
    if(Array.isArray(item.result))queue.push(...item.result);
  }
  return rows;
}
export function inspectSchema27(metaRows,migrationRows,shapeRows,files,mode="preflight"){
  requireSafe(["preflight","postapply","postmarker"].includes(mode),"unknown release check");
  requireSafe(files.length===26&&files[25]===NEW_MIGRATION,"local migration inventory changed");
  requireSafe(metaRows.length===3,"D1 identity metadata must have exactly 3 entries");
  const meta=new Map(metaRows.map(row=>[String(row.key),String(row.value)]));
  requireSafe(meta.size===3,"duplicate D1 identity markers");
  requireSafe(meta.get("app_environment")==="production","not the production database");
  requireSafe(meta.get("instance_id")==="production:xingyu-blog","wrong D1 instance");
  const version=meta.get("schema_version");
  requireSafe(version==="26"||version==="27","unexpected prior schema "+version);
  const applied=migrationRows.map(row=>String(row.name)).sort();
  const prefix=files.slice(0,-1);
  const matches=(names)=>names.length===applied.length&&
    names.every((name,index)=>applied[index]===name);
  requireSafe(matches(prefix)||matches(files),"remote migration inventory differs");
  const migrated=matches(files);
  const labelsTable=shapeRows.some(row=>row.type==="table"&&row.name==="oauth_connection_labels");
  requireSafe(labelsTable===migrated,"migration marker and OAuth label table disagree");
  requireSafe(version!=="27"||migrated,"schema 27 marker without migration");
  if(mode==="postapply"||mode==="postmarker")
    requireSafe(migrated,"migration 0025 is still missing");
  if(mode==="postmarker")requireSafe(version==="27","schema marker not promoted to 27");
  return {
    version,
    needsMigration:!migrated,
    needsMarker:version==="26",
  };
}
function main(){
  const [mode,metaFile,migrationsFile,shapeFile]=process.argv.slice(2);
  requireSafe(mode&&metaFile&&migrationsFile&&shapeFile,"expected mode and three JSON files");
  const files=expectedMigrationFiles();
  const state=inspectSchema27(
    rowsFromD1(JSON.parse(readFileSync(metaFile,"utf8"))),
    rowsFromD1(JSON.parse(readFileSync(migrationsFile,"utf8"))),
    rowsFromD1(JSON.parse(readFileSync(shapeFile,"utf8"))),
    files,mode);
  console.log("Production D1 verified, schema="+state.version);
  console.log("needs_migration="+state.needsMigration);
  console.log("needs_marker="+state.needsMarker);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main()}catch(error){
    console.error(error instanceof Error?error.message:"AXIS release failed");
    process.exitCode=1;
  }
}
