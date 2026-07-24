# Repository Guide

## Product Direction

- The current Astro website and visual design are working well. Prioritize reliability, search quality, naming consistency, maintainability, accessibility, and performance.
- Do not redesign the interface, migrate frameworks, or introduce a monorepo unless explicitly requested.
- Do not begin React or npm-package implementation during v3 cleanup work.
- Intended progression: clean the v3 asset and release pipeline; improve search and discovery in v3.3; prepare SVG and naming infrastructure; introduce React distribution as the defining feature of v4.

## Commands

- Requires Node `>=22.12.0`; dependencies are locked with `package-lock.json`.
- Use `npm run dev`, not the VS Code launch task: the launch task runs `astro dev` directly and skips index generation.
- `npm run build:index` regenerates icon metadata and sprites.
- `npm run build` runs `build:index` before the Astro static build.
- `npm run preview` serves the existing `dist/`; run `npm run build` first.
- There are no test, lint, formatter, or standalone typecheck scripts. Use `npm run build` as the full verification step.
- If Windows PowerShell blocks `npm.ps1`, run commands through `cmd`, for example `cmd /c "npm run build"`.

## Icon Pipeline

- Raw icons live under ignored `public/icons/<family>/<style>/*.svg`; they are not available in a fresh clone.
- `src/scripts/build-index.js` generates the tracked `src/icons.json`, `public/icons.json`, and `public/sprites/*.svg`. Do not hand-edit these generated files.
- After changing raw icons or index-generation logic, run `npm run build:index` and include all resulting generated-file changes.
- Current limitation: when `public/icons/` is absent, `build:index` exits successfully and Astro falls back to tracked metadata and sprites. This can allow stale generated artifacts to pass unnoticed. Do not change this behavior unless the task explicitly covers the v3 build cleanup.
- `src/scripts/copy-icons.js` is not an npm script. It deletes `public/icons/` before copying a root `icons/` directory; run it only when intentionally importing a complete raw icon corpus.
- Sprite symbol IDs must remain `${family}/${style}/${name}` in both `build-index.js` and `app.js`.

## Runtime Coupling

- `src/pages/index.astro` inlines the first sorted family's `regular` sprite for first paint. `app.js` fetches `/icons.json`, lazy-loads other sprites, and keeps only the current sprite's symbols in `#sprite-sheet`.
- `loadSprite()` mutates the shared sprite sheet. Preserve await-before-render ordering when changing filter or sprite-loading behavior; concurrent loads can leave `<use>` references without matching symbols.
- The default style `regular` is duplicated in `src/pages/index.astro`, `src/components/Sidebar.astro`, and `src/scripts/app.js`; update all three together.
- Virtual-scroll constants in `app.js` are coupled to `IconGrid.astro`: `CARD_MIN_WIDTH = 88` matches `5.5rem`, `CARD_GAP = 6` matches `0.375rem`, and `CARD_HEIGHT = 100` matches the 94px card plus 6px gap.
- Preserve tracked filename casing, especially `src/components/IconGrid.astro`, for case-sensitive builds.

## Product Metadata

- `src/data/library.json` is the source of truth for website/release versions, exact catalog counts, expected families/styles, defaults, and release URLs.
- Website and downloadable asset versions are separate because a website release may not publish a new icon ZIP. `package.json` version is the internal Astro app package version, not the product version.
- `README.md` mirrors selected release metadata but cannot import the JSON source; update and verify it when publishing releases.

## Change Discipline

- Inspect source-versus-generated-file relationships before editing. Do not hand-edit generated icon indexes or sprites.
- Avoid bulk SVG modifications unless explicitly requested. Test transformations on a representative sample before applying them broadly, and preserve duoline and duotone structure.
- Do not opportunistically refactor unrelated code. Keep each implementation batch small and reviewable.
