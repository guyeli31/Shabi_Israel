# v2 Changelog

Phase-by-phase rebuild history. Each commit corresponds to a phase or a sub-task. Full plan: [`PLAN.md`](PLAN.md).

## Phase 0 — Bootstrap

- Created `v2/` directory at repo root.
- Initialized `package.json` with Vite + Stylelint + ESLint + Vitest + Playwright as devDependencies.
- Wrote `vite.config.js` with multi-page entries and `shared-data-proxy` plugin serving `../leagues` at `/data`.
- Wrote `.stylelintrc.json` enforcing token-only typography and forbidden hex colors outside tokens.
- Wrote `.eslintrc.json`, `.editorconfig`, `.gitignore`.
- Scaffolded complete directory tree: `src/{tokens,themes,base,primitives,components,tables,data,compute,pages,tools,utils,i18n,entry}`, `public/{icons,fonts,data}`, `docs/`, `tests/`, `scripts/`.
- Wrote placeholder HTML pages for all 6 production pages + 4 tools.
- Wrote per-page entry stubs in `src/entry/*.entry.js`.
- Wrote `src/index.css` declaring the 10-layer cascade order.
- Wrote helper scripts: `data-sync.js`, `parity-runner.js`, `grep-gates.sh`, `inventory-sync.js`, `icon-sprite-build.js`, `migrate-v1-to-v2.sh` (all functional or stubbed per phase).
- Wrote `README.md`, `docs/MIGRATION-FROM-V1.md` (mapping skeleton), `docs/PARITY-LOG.md`, `docs/CHANGELOG.md`.
- Updated root `CLAUDE.md` and `.gitignore` to acknowledge `v2/`.

**Verification**: directory tree confirmed; configs syntactically valid; no `npm install` yet — user runs that to boot dev server on `:5173`.

**Required before Phase 1 starts** (run by the user, once per machine):
```bash
cd v2
npm install
npm run dev    # confirm http://localhost:5173 boots
```
Phase 1 cannot begin until `npm install` succeeds — Vite + Stylelint + Vitest must be present for any verification step.
