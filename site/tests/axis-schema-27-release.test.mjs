import assert from "node:assert/strict";
import test from "node:test";
import {expectedMigrationFiles,inspectSchema27,rowsFromD1} from "../scripts/axis-schema-27-release.mjs";

const files=expectedMigrationFiles();
const meta=(version,environment="production")=>[
  {key:"schema_version",value:version},
  {key:"app_environment",value:environment},
  {key:"instance_id",value:"production:xingyu-blog"},
];
const migrations=(count)=>files.slice(0,count).map(name=>({name}));
const shape=(migrated)=>migrated?[{type:"table",name:"oauth_connection_labels"}]:[];

test("schema 27 release requires exactly the additive migration at index 25",()=>{
  assert.equal(files.length,26);
  assert.equal(files[25],"0025_oauth_connection_labels.sql");
});
test("D1 JSON parser accepts both Wrangler result wrappers and refuses errors",()=>{
  assert.deepEqual(rowsFromD1([{success:true,results:[{name:"x"}]}]),[{name:"x"}]);
  assert.deepEqual(rowsFromD1({result:[{success:true,results:[{name:"y"}]}]}),[{name:"y"}]);
  assert.throws(()=>rowsFromD1([{success:false,results:[]}]),/query failed/);
});
test("preflight permits only exact schema-26 migration inventory",()=>{
  assert.deepEqual(inspectSchema27(meta("26"),migrations(25),shape(false),files),{
    version:"26",needsMigration:true,needsMarker:true,
  });
  assert.deepEqual(inspectSchema27(meta("26"),migrations(26),shape(true),files),{
    version:"26",needsMigration:false,needsMarker:true,
  });
  assert.deepEqual(inspectSchema27(meta("27"),migrations(26),shape(true),files),{
    version:"27",needsMigration:false,needsMarker:false,
  });
});
test("post-migration and post-marker are independent mandatory gates",()=>{
  assert.throws(()=>inspectSchema27(meta("26"),migrations(25),shape(false),files,"postapply"),/still missing/);
  assert.equal(inspectSchema27(meta("26"),migrations(26),shape(true),files,"postapply").version,"26");
  assert.throws(()=>inspectSchema27(meta("26"),migrations(26),shape(true),files,"postmarker"),/not promoted/);
  assert.equal(inspectSchema27(meta("27"),migrations(26),shape(true),files,"postmarker").version,"27");
});
test("reject wrong identity, partial migrations and inconsistent schema",()=>{
  assert.throws(()=>inspectSchema27(meta("25"),migrations(25),shape(false),files),/prior schema/);
  assert.throws(()=>inspectSchema27(meta("26","beta"),migrations(25),shape(false),files),/production database/);
  assert.throws(()=>inspectSchema27(meta("27"),migrations(25),shape(false),files),/without migration/);
  assert.throws(()=>inspectSchema27(meta("26"),migrations(24),shape(false),files),/inventory differs/);
  assert.throws(()=>inspectSchema27(meta("26"),migrations(26),shape(false),files),/disagree/);
  assert.throws(()=>inspectSchema27(meta("26"),migrations(25),shape(true),files),/disagree/);
  assert.throws(()=>inspectSchema27(meta("26"),migrations(26).concat({name:"9999_unexpected.sql"}),shape(true),files),/inventory differs/);
  assert.throws(()=>inspectSchema27(meta("26").concat({key:"instance_id",value:"fake"}),migrations(25),shape(false),files),/3 entries/);
});
