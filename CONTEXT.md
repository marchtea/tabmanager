# TabDock Context

## Product boundary

TabDock is a local-first Manifest V3 Chrome extension that replaces the New Tab page. Its persisted model is `Space -> Stack -> Saved Tab`; the Open Tabs panel reflects live Chrome windows and tabs without copying them into saved data until the user drops a tab into a Stack.

## Architecture

- `src/App.tsx` owns the three-column UI, drag state, drop previews, browser event refresh, and user actions.
- `src/domain/workspaceStore.ts` contains pure Space/Stack/Saved Tab mutations, ordering, normalization, and deduplication.
- `src/domain/persistence.ts` serializes the versioned local state through `chrome.storage.local`.
- `src/chrome/chromeApi.ts` is the browser API adapter for tabs, windows, history, commands, and storage.
- `src/styles.css` defines the warm, compact workspace visual system and drag/drop feedback.

## Important workflows

- Space, Stack, and Saved Tab changes are persisted locally and must remain safe across multiple TabDock pages.
- Space and Stack titles are draggable and show before/after insertion feedback; Open Tabs can be reordered within a Chrome window or moved between windows at a visible insertion position.
- Production output is generated in `dist/`; `npm run package:zip` creates `release/tabdock-extension.zip`.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`, and `npm run build` before tagging. Extension-specific verification is available through `npm run verify:extension`.
