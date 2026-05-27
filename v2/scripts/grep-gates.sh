#!/usr/bin/env bash
# grep-gates.sh — fail CI if forbidden patterns appear in src/.
# Run from v2/ directory.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

check() {
    local label="$1"
    local pattern="$2"
    local include="${3:-src/}"
    local exclude="${4:-}"

    local matches
    if [[ -n "$exclude" ]]; then
        matches=$(grep -rEn "$pattern" "$include" --exclude-dir=node_modules --exclude-dir="$exclude" 2>/dev/null || true)
    else
        matches=$(grep -rEn "$pattern" "$include" --exclude-dir=node_modules 2>/dev/null || true)
    fi

    if [[ -n "$matches" ]]; then
        echo "❌ $label"
        echo "$matches" | head -20
        echo "---"
        fail=1
    else
        echo "✓ $label"
    fi
}

echo "Running grep gates against v2/src/..."

# Forbidden typography literals outside token/theme files
check "No literal font-size in src/ (must use var(--fs-*))" \
    'font-size:[[:space:]]*[0-9]+' "src/" "tokens"

check "No literal font-weight outside token files (must use var(--fw-*))" \
    'font-weight:[[:space:]]*(100|200|300|400|500|600|700|800|900|bold|bolder|lighter)' "src/" "tokens"

check "No !important on typography rules" \
    '(font-size|font-weight).*!important' "src/"

check "No <strong>/<b> tags for visual styling" \
    '<(strong|b)[[:space:]>]' "src/" "i18n"

# Forbidden color literals outside token/theme files
check "No hex colors outside tokens/themes" \
    '#[0-9a-fA-F]{3,8}\b' "src/components src/primitives src/tables src/pages src/tools"

if [[ $fail -eq 1 ]]; then
    echo "Grep gates FAILED."
    exit 1
fi

echo "All grep gates PASSED."
