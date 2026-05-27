# Parity Log

Side-by-side v1↔v2 verification results. Each phase appends to the bottom. Cutover requires all checks ✓.

## Format

```markdown
## YYYY-MM-DD — {page} @ vw={width} × theme={theme}
| Selector | Property | v1 | v2 | Δ | Pass |
|---|---|---|---|---|---|
| #leagueTable td | fontSize | 12.036px | 12.036px | 0 | ✓ |
| ... | | | | | |

Screenshot diff: X.X% — PASS/FAIL
```

## Tolerances

| Property | Allowed delta |
|---|---|
| font-size (px) | 0.01px |
| font-weight | exact match |
| font-family | exact match |
| color (RGB) | exact match |
| box width/height | ≤2px |
| box position | ≤2px |
| pixel diff (screenshot) | ≤2% of pixels, no diff > 8 RGB units |

---

## Phase 0 — Bootstrap (no parity checks yet; scaffolding only)
