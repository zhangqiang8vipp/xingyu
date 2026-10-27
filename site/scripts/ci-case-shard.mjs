/**
 * Case-level CI sharding without reducing security tests.
 * package.json:test:integration remains the single source of truth.
 * Every statically registered node:test case is assigned exactly once.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { listedIntegrationTests } from "./ci-integration-shard.mjs";

const SITE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DURATION_PROFILE = JSON.parse(readFileSync(new URL("./ci-case-durations.json", import.meta.url), "utf8"));
const CASE_DURATION_MS = DURATION_PROFILE.msByName;
// Baseline average runtime by file from green run 40440895386.
// Weights affect scheduling only, never coverage.
const AVERAGE_MS_BY_FILE = {
  "instance-safety": 4600, "security-contracts": 2200,
  "schema-migrations": 2350, "post-write-contracts": 2070,
  "views-contracts": 1510, "read-session-contracts": 3025,
  "knowledge-import-contracts": 4370, "private-beta-safety-contracts": 2400,
  "workspace-isolation": 4200, "identity-verification": 9600,
  "identity-mcp-oauth": 4080, "identity-personal-pat": 6030,
  "identity-password-recovery": 5950, "workspace-collaboration": 3200,
  "organization-members-units": 8575, "team-workspace-acl": 7500,
  "personal-admin-portal": 4020, "knowledge-qa": 3220,
  "admin-ask-model-config": 4170, "space-ai-collaboration": 4240,
};
const escapeRegExp = value => value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");

export function discoverIntegrationCases(manifest, root = SITE_ROOT) {
  const files = listedIntegrationTests(manifest);
  const cases = [];
  const unique = new Set();
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (tree.parseDiagnostics.length) throw new Error("Unparseable integration source: " + file);
    const names = [];
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const directTest = ts.isIdentifier(callee) && callee.text === "test";
        const specialTest = ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) && callee.expression.text === "test" &&
          ["skip", "todo", "only"].includes(callee.name.text);
        if (specialTest) throw new Error("Explicit skip/only/todo forbidden in complete CI: " + file);
        if (directTest) {
          const first = node.arguments[0];
          if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)))
            throw new Error("Dynamic test title cannot be sharded safely: " + file);
          const title = first.text;
          if (!title.trim() || unique.has(title)) throw new Error("Empty or duplicate test title: " + title);
          unique.add(title);
          names.push(title);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    if (!names.length) throw new Error("No statically registered tests in " + file);
    const base = path.basename(file, ".test.mjs");
    for (const name of names) {
      const measured = CASE_DURATION_MS[name];
      const weight = Number.isFinite(measured) && measured > 0
        ? measured : (AVERAGE_MS_BY_FILE[base] ?? 4000);
      cases.push({file, name, weight});
    }
  }
  return cases;
}

export function planCaseShards(cases, count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > cases.length)
    throw new Error("Invalid integration shard count");
  if (new Set(cases.map(x => x.file + "\0" + x.name)).size !== cases.length)
    throw new Error("Duplicate integration case assignment");
  const groups = Array.from({length: count}, (_, id) => ({id, expectedMs: 0, cases: []}));
  const sorted = [...cases].sort((a,b) =>
    b.weight - a.weight || a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  for (const testCase of sorted) {
    groups.sort((a,b) => a.expectedMs-b.expectedMs || a.cases.length-b.cases.length || a.id-b.id);
    groups[0].cases.push(testCase);
    groups[0].expectedMs += testCase.weight;
  }
  return groups.sort((a,b) => a.id-b.id);
}

export function casePattern(cases) {
  if (!cases.length) throw new Error("Empty shard is not allowed");
  return "^(?:" + cases.map(item => escapeRegExp(item.name)).join("|") + ")$";
}

export function assertCompleteCoverage(sourceCases, groups) {
  const source = new Set(sourceCases.map(x => x.file + "\0" + x.name));
  const executed = groups.flatMap(g => g.cases);
  const unique = new Set(executed.map(x => x.file + "\0" + x.name));
  if (unique.size !== executed.length || source.size !== unique.size ||
    [...unique].some(key => !source.has(key)))
    throw new Error("Missing or duplicate D1/Worker test cases in CI shards");
  for (const group of groups) {
    if (!group.cases.length) throw new Error("Empty integration shard");
    const titles = new Set(group.cases.map(t => t.name));
    const fileSet = new Set(group.cases.map(t => t.file));
    const pattern = new RegExp(casePattern(group.cases));
    const actual = sourceCases.filter(t => fileSet.has(t.file) && pattern.test(t.name));
    if (actual.length !== group.cases.length || actual.some(t => !titles.has(t.name)))
      throw new Error("Shard pattern would run a wrong or omit an assigned test");
  }
  return executed.length;
}

function runShard(index, total) {
  const manifest = JSON.parse(readFileSync(path.join(SITE_ROOT, "package.json"), "utf8"));
  const cases = discoverIntegrationCases(manifest);
  const shards = planCaseShards(cases, total);
  const complete = assertCompleteCoverage(cases, shards);
  const selected = shards[index]?.cases;
  if (!selected?.length) throw new Error("Invalid or empty shard: " + index);
  const files = [...new Set(selected.map(t => t.file))];
  console.log("Case-level Worker/D1 shard " + index + "/" + total + ": " +
    selected.length + " tests in " + files.length + " files. Full coverage: " + complete);
  const result = spawnSync(process.execPath, [
    "--test", "--test-concurrency=8", "--test-name-pattern=" + casePattern(selected),
    ...files,
  ], {cwd: SITE_ROOT, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {process.exitCode = result.status || 1;return;}
  const passed = [...(result.stdout ?? "").matchAll(/^# pass (\d+)\s*$/gm)].at(-1);
  const failed = [...(result.stdout ?? "").matchAll(/^# fail (\d+)\s*$/gm)].at(-1);
  const count = Number(passed?.[1] ?? -1);
  if (count !== selected.length || Number(failed?.[1] ?? -1) !== 0) {
    console.error("FAIL CLOSED: expected " + selected.length + " passing tests; got " + count);
    process.exitCode = 1;return;
  }
  console.log("PASS verified shard " + index + ": " + count + "/" + selected.length +
    " tests passed, without missing assignments.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {runShard(Number(process.argv[2]), Number(process.argv[3]));}
  catch (error) {console.error(error);process.exitCode = 1;}
}
