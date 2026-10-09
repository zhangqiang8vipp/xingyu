# XINGYU Document Blocks — extension boundary

This directory is the **document presentation** boundary, separate from
blog business logic, authentication, database migrations and MCP writes.

## Adding a new built-in component

1. Define a versioned discriminated type and an exact-key, bounded parser in
   `schema.ts`. Invalid and unknown blocks must fall back to original Markdown.
2. Create a React renderer within this directory, then register it in
   `XingyuBlockView.tsx`. As the catalog grows, prefer self-contained view
   modules (as with `FlashcardsView` and `MiniChartView`) and eventually
   modularize the schema/view registry entirely.
3. Register its type, Chinese label and machine-readable shape **once** in
   `catalog.ts`. Existing MCP instructions and draft/update descriptions
   import that catalog; adding a built-in type does not require editing
   Worker business logic.
4. Keep styling under `.markdown-body .xy-block`, inherit existing light/dark
   theme tokens, and respect the public stylesheet budget and mobile width.
5. Add valid and malformed tests, security regressions, docs and mobile/browser
   checks. Run `cd site && npm ci && npm run ci` before merging.

## Stable integration surface

- The Markdown layer imports only `parseXingyuBlock` and
  `XingyuBlockView`; other page/editor code is not changed.
- The MCP server reads only pure metadata from `catalog.ts`: no React, HTTP
  fetch, AI inference, permissions or write side effects.
- Stored content remains standard Markdown with optional, versioned
  `xingyu-block` fenced JSON. There is no new database schema.
- Private knowledge boundaries, instance identity, content versions and
  draft/publish permissions remain the responsibility of XINGYU business code.
- Third-party components are **not** executed dynamically from article data.
  Only explicitly installed and reviewed components can join the catalog.

## Future independent open-source package

When the public schema stabilizes, the parser/types, pure component catalog,
React view modules and scoped theme styles can move into a separately
versioned npm package. The XINGYU Markdown adapter, authorization and MCP
writes must stay with the application. Persisted type/version contracts must
remain backward compatible and readable after package upgrades.
