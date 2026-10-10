# Reader first-open double flash · 2026-10-09

## Symptom

The user observed a visible double blink the **first time** a post opens in window/modal reading mode. Later opens were less affected.

## Root-cause analysis (confirmed by source code)

`site/features/reader/ModalPostLink.tsx` dynamically imports `ModalPostReader` inside React `Suspense`. On cold load, `ReaderChunkFallback` mounts a full `.reader-modal > .reader-layout > .reader-panel` skeleton. When the reader chunk is ready, React replaces that subtree with the real reader, which mounts another `.reader-modal / .reader-panel`.

The existing `site/app/globals.css` animates **both** `.reader-modal` (backdrop fade) and `.reader-panel` (desktop popup or mobile slide). Thus one click caused **two entry animations**, matching the perceived double flash.

## Fix

- Wrap the fallback and real reader in a persistent `.reader-open-once` element outside the `Suspense` boundary.
- Move the single entry fade to the persistent wrapper and suppress animation re-entry on the nested modal/panel in both desktop and mobile CSS.
- Keep lazy loading, full screen/background treatment, reader skeleton, close behavior, article fetch, scroll locking and keyboard handling unchanged.
- Match the fallback toolbar label to admin/public reading mode.
- Respect `prefers-reduced-motion`.

No route transition, data, permission, API, publication, or knowledge-space behavior is modified.

## Browser evidence (isolated fixture, not deployed app)

Simulated the same CSS animations and a 140ms fallback-to-real subtree replacement in Chromium via Playwright. Recorded `animationstart` events across desktop/mobile.

| Fixture | Before | After |
| --- | --- | --- |
| 1440px desktop | 4 events (2 backdrop, 2 panel) | 1 event (persistent wrapper) |
| 390px mobile | 4 events (2 backdrop, 2 mobile panel) | 1 event (persistent wrapper) |

A source regression test was added to `site/tests/rendered-html.test.mjs`.

## Pending integration checks

- Full `cd site && npm ci && npm run ci`, including compiled CSS and lazy chunk manifest.
- Real first/cold and second/warm opens in desktop and mobile browsers with devtools network throttling.
- Open and close, article switches, admin reader, private Knowledge Space, keyboard Escape, outside click and mobile scroll restoration.
- Ensure existing lazy loading / bundle split remains intact.

Status: **Draft only**. No main merge or deployment.
