import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateManifest,evaluateTarget } from "../scripts/prune-reviewed-branches.mjs";

const manifest=JSON.parse(readFileSync(new URL("../scripts/prune-reviewed-branches.json",import.meta.url),"utf8"));
const merged=manifest.targets.find(t=>t.reason==="merged");
const abandoned=manifest.targets.find(t=>t.reason==="abandoned");
const noDiff=manifest.targets.find(t=>t.reason==="no-diff");
const branch=t=>({name:t.name,protected:false,commit:{sha:t.sha}});
const pull=(t,mergedAt)=>({number:t.pr,state:"closed",merged_at:mergedAt,
  head:{ref:t.name,sha:t.sha,repo:{full_name:"zhangqiang8vipp/xingyu"}}});

test("cleanup manifest pins 46 unique, reviewed, non-default branch SHA pairs",()=>{
  assert.equal(validateManifest(manifest),true);
  assert.equal(manifest.targets.length,46);
  assert.equal(manifest.targets.filter(t=>t.reason==="merged").length,39);
  assert.equal(manifest.targets.filter(t=>t.reason==="abandoned").length,4);
  assert.equal(manifest.targets.filter(t=>t.reason==="no-diff").length,3);
  assert.equal(manifest.targets.some(t=>t.name==="main"),false);
  assert.throws(()=>validateManifest({...manifest,targets:[...manifest.targets,merged]}),/Unsafe/);
  assert.throws(()=>validateManifest({...manifest,targets:manifest.targets.map((t,i)=>i===0?{...t,name:"main"}:t)}),/Unsafe/);
});

test("cleanup only approves exact merged heads that are unchanged and not in active PRs",()=>{
  assert.equal(evaluateTarget(merged,branch(merged),pull(merged,"2026-10-27T00:00:00Z"),null,new Set()),null);
  assert.match(evaluateTarget(merged,{...branch(merged),commit:{sha:"a".repeat(40)}},pull(merged,"yes"),null,new Set()),/SHA changed/);
  assert.match(evaluateTarget(merged,{...branch(merged),protected:true},pull(merged,"yes"),null,new Set()),/protected/);
  assert.match(evaluateTarget(merged,branch(merged),pull(merged,"yes"),null,new Set([merged.name])),/open pull/);
  assert.match(evaluateTarget(merged,branch(merged),pull(merged,null),null,new Set()),/not merged/);
});

test("closed-unmerged and no-difference branches must pass their own guards",()=>{
  assert.equal(evaluateTarget(abandoned,branch(abandoned),pull(abandoned,null),null,new Set()),null);
  assert.match(evaluateTarget(abandoned,branch(abandoned),pull(abandoned,"yes"),null,new Set()),/reopened\/merged/);
  assert.equal(evaluateTarget(noDiff,branch(noDiff),null,{ahead_by:0,files:[]},new Set()),null);
  assert.equal(evaluateTarget(noDiff,branch(noDiff),null,{ahead_by:4,files:[]},new Set()),null);
  assert.match(evaluateTarget(noDiff,branch(noDiff),null,{ahead_by:1,files:[{filename:"important.ts"}]},new Set()),/no-diff/);
});
