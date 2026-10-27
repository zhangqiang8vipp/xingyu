/**
 * A manual, fixed-SHA GitHub branch cleanup.
 * Each candidate must match the reviewed SHA and its PR outcome / no-diff proof.
 * The GitHub token never leaves the runner. No production code/data changes.
 */
import { readFileSync,appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO="zhangqiang8vipp/xingyu";
const SELF_BRANCH="ops/manual-branch-prune-20261027";
const SHA=/^[a-f0-9]{40}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/;
const source=JSON.parse(readFileSync(new URL("./prune-reviewed-branches.json",import.meta.url),"utf8"));

export function validateManifest(manifest=source){
  if(manifest?.version!==1||manifest.repository!==REPO||!Array.isArray(manifest.targets))
    throw new Error("Unexpected reviewed branch manifest");
  const seen=new Set();
  for(const t of manifest.targets){
    if(!NAME.test(t.name)||t.name.includes("..")||t.name.includes("//")||
       t.name==="main"||t.name.startsWith("refs/")||seen.has(t.name)||!SHA.test(t.sha)||
       !["merged","abandoned","no-diff"].includes(t.reason)||
       (t.reason!=="no-diff"&&(!Number.isInteger(t.pr)||t.pr<1)))
      throw new Error("Unsafe branch manifest entry: "+String(t.name));
    seen.add(t.name);
  }
  if(manifest.targets.length!==46)throw new Error("Unexpected number of reviewed branches");
  return true;
}

export function evaluateTarget(target,branch,pr,comparison,openHeads){
  if(!branch)return "branch no longer exists";
  if(branch.name!==target.name||branch.commit?.sha!==target.sha)return "SHA changed; retained";
  if(branch.protected)return "protected branch; retained";
  if(openHeads.has(target.name))return "open pull request; retained";
  if(target.reason==="no-diff"){
    if(!comparison || (comparison.ahead_by!==0 &&
       (!Array.isArray(comparison.files)||comparison.files.length!==0)))
       return "not demonstrably no-diff; retained";
    return null;
  }
  if(!pr||pr.head?.ref!==target.name||pr.head?.sha!==target.sha||
     pr.head?.repo?.full_name!==REPO)return "associated PR head no longer matches";
  if(target.reason==="merged")
    return pr.merged_at&&pr.state==="closed"?null:"PR not merged";
  return pr.state==="closed"&&!pr.merged_at?null:"abandoned PR was reopened/merged";
}

const segmentPath=name=>name.split("/").map(encodeURIComponent).join("/");
async function gh(method,endpoint,token){
  const url="https://api.github.com/repos/"+REPO+"/"+endpoint;
  const response=await fetch(url,{
    method,headers:{Accept:"application/vnd.github+json",
      Authorization:"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28"},
    signal:AbortSignal.timeout(20000),
  });
  if(response.status===404)return null;
  if(!response.ok)throw new Error(method+" "+endpoint+" failed, HTTP "+response.status);
  if(response.status===204)return true;
  return response.json();
}
async function listOpenPulls(token){
  const result=[];
  for(let page=1;page<=20;page++){
    const part=await gh("GET","pulls?state=open&per_page=100&page="+page,token);
    if(!Array.isArray(part))throw new Error("Open PR listing is invalid");
    result.push(...part);
    if(part.length<100)return result;
  }
  throw new Error("Too many open PR pages; cleanup cannot prove safety");
}
async function selfTarget(token){
  const branch=await gh("GET","branches/"+encodeURIComponent(SELF_BRANCH),token);
  if(!branch)return null;
  const prs=await gh("GET","pulls?state=closed&head=zhangqiang8vipp%3A"+
    encodeURIComponent(SELF_BRANCH)+"&per_page=100",token);
  const p=Array.isArray(prs)?prs.find(row=>row.merged_at && row.head?.ref===SELF_BRANCH &&
    row.head?.sha===branch.commit.sha&&row.head?.repo?.full_name===REPO):null;
  return p?{name:SELF_BRANCH,sha:branch.commit.sha,reason:"merged",pr:p.number}:null;
}
function summary(rows,mode){
  const counts={deleted:0,eligible:0,skipped:0};
  for(const row of rows){if(row.action==="DELETED")counts.deleted++;
    else if(row.action==="READY")counts.eligible++;else counts.skipped++;}
  const lines=["## Reviewed GitHub branch cleanup ("+mode+")",
    "Repository: "+REPO+". **No production data, issues or PRs are deleted.**",
    "Result: "+counts.deleted+" deleted, "+counts.eligible+" eligible for deletion, "+
      counts.skipped+" skipped.","","| Branch | Action | Verification |","|---|---|---|",
    ...rows.map(row=>"| "+row.name+" | "+row.action+" | "+row.note+" |")];
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join("\n")+"\n");
  console.log(lines.join("\n"));return counts;
}
export async function runCleanup(env=process.env){
  validateManifest();
  const mode=env.PRUNE_MODE??"preview";
  if(!["preview","delete"].includes(mode))throw new Error("Invalid cleanup mode");
  if(mode==="delete"&&env.PRUNE_CONFIRM!=="DELETE-REVIEWED")
    throw new Error("Refusing delete: exact DELETE-REVIEWED confirmation required");
  if(env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=="refs/heads/main"||
     !SHA.test(env.GITHUB_SHA??"")||!env.GITHUB_TOKEN)
    throw new Error("Cleanup must run on the audited repo's main with an Actions token");
  const token=env.GITHUB_TOKEN;
  const head=await gh("GET","git/ref/heads/main",token);
  if(head?.object?.sha!==env.GITHUB_SHA)throw new Error("main changed during dispatch");
  const openHeads=new Set((await listOpenPulls(token))
    .filter(p=>p.head?.repo?.full_name===REPO).map(p=>p.head.ref));
  const own=await selfTarget(token);
  const targets=[...source.targets,...(own?[own]:[])];
  const rows=[];
  for(const target of targets){
    let branch=await gh("GET","branches/"+encodeURIComponent(target.name),token);
    let pr=target.pr?await gh("GET","pulls/"+target.pr,token):null;
    let comparison=target.reason==="no-diff"
      ?await gh("GET","compare/main..."+target.sha,token):null;
    let reason=evaluateTarget(target,branch,pr,comparison,openHeads);
    if(reason){rows.push({name:target.name,action:"SKIP",note:reason});continue;}
    if(mode==="preview"){rows.push({name:target.name,action:"READY",note:target.reason+"; SHA verified"});continue;}
    // Recheck immediately before issuing DELETE to reduce concurrent-push risks.
    branch=await gh("GET","branches/"+encodeURIComponent(target.name),token);
    reason=evaluateTarget(target,branch,pr,comparison,openHeads);
    if(reason){rows.push({name:target.name,action:"SKIP",note:reason});continue;}
    await gh("DELETE","git/refs/heads/"+segmentPath(target.name),token);
    rows.push({name:target.name,action:"DELETED",note:target.reason+"; exact SHA verified"});
  }
  return summary(rows,mode);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runCleanup().catch(error=>{console.error("Branch cleanup refused: "+
    (error instanceof Error?error.message:String(error)));process.exitCode=1;});
}
