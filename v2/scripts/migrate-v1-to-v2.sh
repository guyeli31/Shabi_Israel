#!/usr/bin/env bash
# migrate-v1-to-v2.sh — one-time cutover script.
# Moves current production (v1) files into _archive_v1/, then promotes v2/* to repo root.
# Run from repo root, ONLY after every Phase 12 exit criterion is met.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "[cutover] Working in $REPO_ROOT"

# Safety: abort if we're not on a clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
    echo "[cutover] ABORT — working tree is dirty. Commit or stash first."
    exit 1
fi

# 1. Archive v1
echo "[cutover] Archiving v1 files into _archive_v1/"
mkdir -p _archive_v1
mv css js table-lab docs \
   admin.html league.html league_table.html player_league.html player.html \
   design-lab.html typo-editor.html design-catalogue.html index.html \
   _archive_v1/ 2>/dev/null || true

# Preserve top-level shared assets (leagues/, CLAUDE.md, etc.) — they stay.

# 2. Promote v2
echo "[cutover] Promoting v2/* to repo root"
shopt -s dotglob 2>/dev/null || setopt dotglob 2>/dev/null || true
mv v2/* v2/.* . 2>/dev/null || true
rmdir v2

# 3. Verify build + tests
echo "[cutover] Running build + tests"
npm ci
npm run build
npm run test

echo "[cutover] DONE. Review the diff, then commit:"
echo "  git add -A"
echo "  git commit -m 'feat(rebuild): cut over from v1 to v2 (clean architecture)'"
