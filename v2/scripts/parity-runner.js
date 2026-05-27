#!/usr/bin/env node
/**
 * parity-runner.js — runs side-by-side v1↔v2 visual + computed-style
 * parity checks across every page × viewport × theme.
 *
 * Phase 0 placeholder. Full implementation lands in Phase 10 (CI gates)
 * but is invoked manually at the end of every page-building phase
 * (Phase 6) to verify v2 matches v1 before proceeding.
 *
 * When implemented, this script:
 *   1. Launches Playwright with two browser contexts
 *   2. Navigates each context to v1 (:8090) and v2 (:5173) of the same page
 *   3. For each (viewport × theme) combination:
 *      a. Resize, switch theme
 *      b. Take screenshots
 *      c. Read computed styles of sentinel selectors
 *      d. Pixel-diff via pixelmatch
 *      e. Assert tolerances (font-size 0.01px, color exact, position ≤2px)
 *   4. Appends results to v2/docs/PARITY-LOG.md
 */

console.warn('[parity-runner] Phase 0 placeholder. Implementation in Phase 10.');
console.warn('[parity-runner] Until then: run Playwright MCP probes manually per page.');
process.exit(0);
