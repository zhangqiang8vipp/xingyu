import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SITE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION_FILE = /^(\d{4})_.+\.sql$/;

function readText(root, relative, errors) {
  try { return readFileSync(path.join(root, relative), "utf8"); }
  catch (error) {
    errors.push(`${relative} is missing or unreadable: ${error.message}`);
    return null;
  }
}

function maskCommentsAndStrings(source) {
  let out = "", i = 0;
  while (i < source.length) {
    if (source[i] === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i += 1; }
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated block comment");
      while (i < end + 2) { out += source[i] === "\n" ? "\n" : " "; i += 1; }
      continue;
    }
    if (["\"", "'", "`"].includes(source[i])) {
      const quote = source[i];
      out += quote; i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { out += "  "; i += 2; continue; }
        out += source[i] === quote ? quote : source[i] === "\n" ? "\n" : " ";
        if (source[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += source[i]; i += 1;
  }
  return out;
}

export function parseApplicationSchemaVersion(source) {
  const masked = maskCommentsAndStrings(source);
  const declaration = /\bexport\s+const\s+schemaVersion\b[^=;]*=\s*/g;
  const matches = [...masked.matchAll(declaration)];
  if (matches.length !== 1) {
    throw new Error(matches.length ? "found multiple exported const schemaVersion declarations" : "could not find an exported const schemaVersion declaration");
  }
  const start = matches[0].index + matches[0][0].length;
  const maskedTail = masked.slice(start);
  const literalOffset = maskedTail.search(/\S/);
  if (literalOffset < 0) throw new Error("schemaVersion has no initializer");
  const tail = source.slice(start + literalOffset);
  const literal = /^(?:"(\d+)"|'(\d+)'|(\d+))(?=\s|;|$)/.exec(tail);
  if (!literal) throw new Error("schemaVersion must be a decimal string or integer literal");
  const value = Number(literal[1] ?? literal[2] ?? literal[3]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("schemaVersion must be a positive safe integer");
  return value;
}

function parseJsonc(source) {
  let out = "", i = 0, quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += source[i + 1] ?? ""; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1; continue;
    }
    if (ch === "\"") { quote = ch; out += ch; i += 1; continue; }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i += 1; }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated block comment");
      while (i < end + 2) { out += source[i] === "\n" ? "\n" : " "; i += 1; }
      continue;
    }
    out += ch; i += 1;
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, "$1"));
}

function globRegex(glob) {
  let regex = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") { regex += "[^/]*"; continue; }
    if (ch === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end < 0) throw new Error("unterminated character class");
      regex += glob.slice(i, end + 1); i = end; continue;
    }
    regex += /[\\^$.*+?(){}|]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`${regex}$`);
}

export function inspectReleasePreflight(siteRoot = DEFAULT_SITE_ROOT) {
  const root = path.resolve(siteRoot), errors = [];
  let schemaVersion = null, latestMigration = null;
  const bootstrap = readText(root, "db/bootstrap.ts", errors);
  if (bootstrap !== null) {
    try { schemaVersion = parseApplicationSchemaVersion(bootstrap); }
    catch (error) { errors.push(`db/bootstrap.ts schemaVersion could not be parsed: ${error.message}`); }
  }

  let entries = [], journalValid = true;
  const journalText = readText(root, "drizzle/meta/_journal.json", errors);
  if (journalText !== null) {
    try {
      const journal = JSON.parse(journalText);
      if (!Array.isArray(journal.entries) || journal.entries.length === 0) throw new Error("must contain a non-empty entries array");
      entries = journal.entries;
    } catch (error) {
      errors.push(`drizzle/meta/_journal.json is invalid: ${error.message}`);
      journalValid = false;
    }
  } else journalValid = false;

  const tags = new Set(), ids = new Set(), indexes = new Set();
  for (let position = 0; position < entries.length; position += 1) {
    const entry = entries[position];
    if (!Number.isInteger(entry?.idx)) { errors.push(`journal entry ${position} has invalid idx`); journalValid = false; continue; }
    if (indexes.has(entry.idx)) { errors.push(`journal repeats migration idx ${entry.idx}`); journalValid = false; }
    indexes.add(entry.idx);
    if (entry.idx !== position) { errors.push(`journal entry ${position} has idx ${entry.idx}; expected ${position}`); journalValid = false; }
    if (typeof entry.tag !== "string") { errors.push(`journal entry ${position} has invalid tag`); journalValid = false; continue; }
    if (tags.has(entry.tag)) { errors.push(`journal repeats migration tag ${entry.tag}`); journalValid = false; }
    tags.add(entry.tag);
    const match = /^(\d{4})_.+$/.exec(entry.tag);
    if (!match) { errors.push(`journal migration tag ${entry.tag} must start with a four-digit id`); journalValid = false; continue; }
    if (ids.has(match[1])) { errors.push(`journal repeats migration id ${match[1]}`); journalValid = false; }
    ids.add(match[1]);
    if (Number(match[1]) !== entry.idx) { errors.push(`journal migration ${entry.tag} has idx ${entry.idx}; expected ${Number(match[1])}`); journalValid = false; }
  }

  let sqlFiles = [];
  try { sqlFiles = readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql")).sort(); }
  catch (error) { errors.push(`drizzle migration directory is missing or unreadable: ${error.message}`); }
  const numbered = sqlFiles.filter((name) => MIGRATION_FILE.test(name));
  const sqlTags = new Set(numbered.map((name) => name.slice(0, -4)));
  for (const tag of tags) if (!sqlTags.has(tag)) errors.push(`drizzle/meta/_journal.json references ${tag}, but drizzle/${tag}.sql is missing`);
  for (const file of numbered) {
    const tag = file.slice(0, -4);
    if (!tags.has(tag)) errors.push(`drizzle/${file} exists but drizzle/meta/_journal.json does not record ${tag}`);
  }
  if (journalValid && entries.length) {
    latestMigration = `${entries.at(-1).tag}.sql`;
    const expectedSchema = entries.length + 1;
    if (schemaVersion !== null && schemaVersion !== expectedSchema) {
      errors.push(`application requires schema ${schemaVersion}, but latest recorded migration is ${latestMigration} (journal maps it to schema ${expectedSchema})`);
    }
  }

  const wranglerText = readText(root, "wrangler.production.jsonc", errors);
  if (wranglerText !== null) {
    try {
      const config = parseJsonc(wranglerText);
      if (config.vars?.DB_SCHEMA_MODE !== "migration-only") {
        errors.push(`wrangler.production.jsonc must set vars.DB_SCHEMA_MODE to "migration-only"; found ${JSON.stringify(config.vars?.DB_SCHEMA_MODE)}`);
      }
      const dbs = Array.isArray(config.d1_databases) ? config.d1_databases.filter((db) => db?.binding === "DB") : [];
      if (dbs.length !== 1) errors.push(`wrangler.production.jsonc must declare exactly one D1 binding named DB; found ${dbs.length}`);
      else {
        const db = dbs[0];
        if (typeof db.migrations_dir !== "string" || path.resolve(root, db.migrations_dir) !== path.resolve(root, "drizzle")) {
          errors.push(`wrangler.production.jsonc DB migrations_dir must resolve to site/drizzle; found ${JSON.stringify(db.migrations_dir)}`);
        }
        if (typeof db.migrations_pattern !== "string" || !db.migrations_pattern) errors.push("wrangler.production.jsonc DB binding must declare migrations_pattern");
        else {
          const matcher = globRegex(db.migrations_pattern);
          const uncovered = numbered.map((f) => `drizzle/${f}`).filter((f) => !matcher.test(f));
          if (uncovered.length) errors.push(`wrangler.production.jsonc migrations_pattern ${JSON.stringify(db.migrations_pattern)} does not cover numbered migrations: ${uncovered.slice(0, 3).join(", ")}`);
          const accidental = sqlFiles.filter((f) => !MIGRATION_FILE.test(f)).map((f) => `drizzle/${f}`).filter((f) => matcher.test(f));
          if (accidental.length) errors.push(`wrangler.production.jsonc migrations_pattern ${JSON.stringify(db.migrations_pattern)} also matches non-migration SQL: ${accidental.slice(0, 3).join(", ")}`);
        }
      }
    } catch (error) { errors.push(`wrangler.production.jsonc could not be parsed or validated: ${error.message}`); }
  }

  return { ok: errors.length === 0, errors, schemaVersion, latestMigration, migrationCount: numbered.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = inspectReleasePreflight();
  if (!result.ok) {
    console.error("Release preflight failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Release preflight passed: schema ${result.schemaVersion}; latest migration ${result.latestMigration}; ${result.migrationCount} numbered migrations; production mode migration-only.`);
  }
}
