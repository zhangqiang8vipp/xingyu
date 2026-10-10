/**
 * Stage route-only account CSS before dev/build.
 *
 * Source of truth stays the original Admin CSS and the account adapter.
 * No copy of the CSS is committed, so future admin design tweaks stay in sync.
 */
import { readFileSync, writeFileSync } from "node:fs";

const base = new URL("../", import.meta.url);
const sources = [
  "app/admin/admin.css",
  "features/admin/account-ui-adapter.css",
];
const contents = sources.map(source => {
  const css = readFileSync(new URL(source, base), "utf8");
  return "/* Source: " + source + " */\n" + css;
}).join("\n\n");
const target = new URL("public/account-admin.css", base);
writeFileSync(target, "/* Generated. Do not edit. */\n" + contents + "\n", "utf8");
console.log("Staged account-only CSS from existing admin theme");
