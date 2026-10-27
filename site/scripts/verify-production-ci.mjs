/**
 * Verify the existing full CI result for this exact main-branch commit.
 * This prevents production releases from silently skipping any security tests,
 * without rerunning all test suites sequentially during deployment.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REQUIRED_JOBS = [
  "ESLint", "TypeScript and Worker bindings",
  "Production build and full source test suite", "verify",
];
const SHARD_COUNT = 16;

export function assessMainCi(payload, sha) {
  if (!payload || !Array.isArray(payload.workflow_runs)) throw new Error("Invalid GitHub CI run response");
  const runs = payload.workflow_runs
    .filter(run => run.name === "CI" && run.event === "push"
      && run.head_branch === "main" && run.head_sha === sha
      && Number.isSafeInteger(run.id))
    .sort((a,b) => b.id - a.id);
  if (!runs.length) return {state:"waiting", detail:"No exact-commit main push CI run yet"};
  const latest=runs[0];
  if (latest.status !== "completed") return {state:"waiting", detail:"CI run "+latest.id+" is "+latest.status};
  if (latest.conclusion !== "success") throw new Error("Required main CI run "+latest.id+" failed: "+latest.conclusion);
  return {state:"passed",runId:latest.id};
}

export function assertCompleteCiJobs(payload) {
  if (!payload || !Array.isArray(payload.jobs)) throw new Error("Invalid GitHub CI jobs response");
  for (const name of REQUIRED_JOBS) {
    const candidates=payload.jobs.filter(job=>job.name===name);
    if (candidates.length!==1 || candidates[0].status!=="completed" || candidates[0].conclusion!=="success") {
      throw new Error("Required CI job not successful: "+name);
    }
  }
  const seen=new Set();
  for (const job of payload.jobs) {
    const match=/^Worker\/D1 case shard (\d+) of 16$/.exec(job.name);
    if (!match) continue;
    const number=Number(match[1]);
    if (number<0 || number>=SHARD_COUNT || seen.has(number)
      || job.status!=="completed" || job.conclusion!=="success") {
      throw new Error("Incomplete or failed CI integration shard: "+job.name);
    }
    seen.add(number);
  }
  if (seen.size!==SHARD_COUNT) throw new Error("Missing full Worker/D1 integration coverage: "+seen.size+"/"+SHARD_COUNT);
  return true;
}

export async function verifyProductionCi(env=process.env, get=globalThis.fetch) {
  const repo=env.GITHUB_REPOSITORY, sha=env.GITHUB_SHA, token=env.GITHUB_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo??"")
    || !/^[a-f0-9]{40}$/.test(sha??"") || !token)
    throw new Error("GitHub repository, exact SHA and read-only Actions token are required");
  const apiUrl=(env.GITHUB_API_URL??"https://api.github.com").replace(/\/$/,"");
  const getJson=async endpoint=>{
    const response=await get(apiUrl+"/repos/"+repo+"/"+endpoint,{
      headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+token,
        "X-GitHub-Api-Version":"2022-11-28"},
      signal:AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("GitHub CI verification API returned HTTP "+response.status);
    return response.json();
  };
  const head=await getJson("git/ref/heads/main");
  if (head?.object?.sha!==sha) throw new Error("main moved after production dispatch; select latest main and start a new release");
  const until=Date.now()+12*60*1000;
  while (Date.now()<until) {
    const result=assessMainCi(await getJson(
      "actions/workflows/ci.yml/runs?event=push&head_sha="+sha+"&per_page=30"),sha);
    if (result.state==="passed") {
      const jobs=await getJson("actions/runs/"+result.runId+"/jobs?per_page=100");
      assertCompleteCiJobs(jobs);
      console.log("Full required CI verified for exact SHA "+sha.slice(0,12)+
        " (push workflow run "+result.runId+", 16/16 integration shards passed)");
      return result.runId;
    }
    console.log(result.detail+"; waiting for required CI to complete");
    await sleep(12000);
  }
  throw new Error("Timed out waiting for required main CI on exact production commit");
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  verifyProductionCi().catch(error=>{
    console.error("Production CI gate: "+(error instanceof Error?error.message:String(error)));
    process.exitCode=1;
  });
}
