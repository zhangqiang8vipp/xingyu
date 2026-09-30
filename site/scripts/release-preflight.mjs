import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SITE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const NUMBERED_MIGRATION = /^(\d{4})_(.+)\.sql$/;

function readRequiredFile(siteRoot, relativePath, errors) {
  try {
    return readFileSync(path.join(siteRoot, relativePath), "utf8");
  } catch (error) {
    errors.push(`${relativePath} is missing or unreadable: ${error.message}`);
    return null;
  }
}

function tokenizeTypeScript(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("unterminated block comment");
      index = end + 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      const quote = char;
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === "\\") {
          if (index + 1 >= source.length) break;
          value += source[index + 1];
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          closed = true;
          break;
        }
        if (current === "\n" || current === "\r") break;
        value += current;
        index += 1;
      }
      if (!closed) throw new Error("unterminated string literal");
      tokens.push({ type: "string", value });
      continue;
    }
    if (char === "`") {
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error("unterminated template literal");
      tokens.push({ type: "template", value: "" });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }
    if (/[0-9]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9_]/.test(source[index])) index += 1;
      tokens.push({ type: "number", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ type: "punctuation", value: char });
    index += 1;
  }
  return tokens;
}

export function parseApplicationSchemaVersion(source) {
  const tokens = tokenizeTypeScript(source);
  const declarations = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index].value !== "export" || tokens[index + 1].value !== "const"
      || tokens[index + 2].value !== "schemaVersion") continue;
    let cursor = index + 3;
    while (cursor < tokens.length && tokens[cursor].value !== "="
      && tokens[cursor].value !== ";" && tokens[cursor].value !== ",") cursor += 1;
    if (tokens[cursor]?.value !== "=") {
      declarations.push({ error: "schemaVersion declaration has no initializer" });
      continue;
    }
    const initializer = tokens[cursor + 1];
    if (!initializer || !["string", "number"].includes(initialir.type)) {
      declarations.push({ error: "schemaVersion must be a decimal string or integer literal" });
      continue;
    }
    const literal = initializer.value.replaceAll("_", "");
    if (!/^\d+$/.test(literal)) {
      declarations.push({ error: "schemaVersion must contain only decimal digits" });
      continue;
    }
    const value = Number(literal);
    if (!Number.isSafeInteger(value) || value < 1) {
      declarations.push({ error: "schemaVersion must be a positive safe integer" });
      continue;
    }
    declarations.push({ value });
  }
  if (declarations.length === 0) {
    throw new Error("could not find an exported const schemaVersion declaration");
  }
  if (declarations.length > 1) {
    throw new Error("found multiple exported const schemaVersion declarations");
  }
  if (declarations[0].error) throw new Error(declarations[0].error);
  return declarations[0].value;
}
