/**
 * wc26-data.js — Single source of truth for the WC26 (מונדיאל 2026) betting pool.
 *
 * Three datasets, one per dashboard section:
 *   MAIN      — overall ranking (pre-match + regular results + challenges = total)
 *   ACCURACY  — result-guess accuracy (בול / כיוון / טעות)
 *   PREMATCH  — the one-off pre-tournament bets, per category
 *
 * Player names are Hebrew and MUST be byte-identical across all three datasets
 * (note: "דן בן שימול" with a shin, not "שמול").
 *
 * Points are numbers, not strings. Empty pre-match cells are simply absent from
 * a player's `values` map (rendered as "–", never 0).
 */

/* ── Section 1: overall ranking ──────────────────────────────────────
   pre       = משחק מקדים  (pre-match bets)
   regular   = תוצאות רגילות (per-match result bets)
   challenge = אתגרים       (NET side-challenge points — the pre-match total
               is already subtracted out, so this column does NOT include it)
   total     = the authoritative final score (source of truth). By design the
               three displayed columns do NOT sum to `total`, because `challenge`
               shows the net-of-pre figure while `total` still counts pre once.  */
export const MAIN = [
  { name: 'לירון לברן',  pre: 50.00, regular: 79.00,  challenge: 119.31, total: 298.31 },
  { name: 'אורן כהן',    pre: 40.00, regular: 82.00,  challenge: 133.30, total: 295.30 },
  { name: 'עופר דהן',    pre: 30.00, regular: 91.00,  challenge: 129.69, total: 280.69 },
  { name: 'תומר מור',    pre: 49.00, regular: 66.00,  challenge: 104.70, total: 268.70 },
  { name: 'אור קסלר',    pre: 14.00, regular: 103.00, challenge: 128.33, total: 259.33 },
  { name: 'איתי בכר',    pre: 26.00, regular: 91.00,  challenge: 94.00,  total: 237.00 },
  { name: 'גיא אליהו',   pre: 20.00, regular: 111.00, challenge: 80.00,  total: 231.00 },
  { name: 'אביעד צארום', pre: 49.00, regular: 45.00,  challenge: 87.73,  total: 230.73 },
  { name: 'שחר גלר',     pre: 26.00, regular: 71.00,  challenge: 94.78,  total: 217.78 },
  { name: 'דור סימוני',  pre: 25.00, regular: 82.00,  challenge: 72.55,  total: 204.55 },
  { name: 'אלעד ירמיהו', pre: 20.00, regular: 79.01,  challenge: 76.42,  total: 195.43 },
  { name: 'דן בן שימול', pre: 10.00, regular: 105.00, challenge: 65.44,  total: 190.44 },
  { name: 'ירדן אבישי',  pre: 26.00, regular: 62.00,  challenge: 69.52,  total: 183.52 },
  { name: 'עומר גלזר',   pre: 24.00, regular: 52.00,  challenge: 82.03,  total: 182.03 },
  { name: 'דור יאירי',   pre: 20.00, regular: 61.00,  challenge: 49.18,  total: 150.18 },
];

/* ── Section 2: result-guess accuracy ────────────────────────────────
   bull      = בול   (exact score)
   direction = כיוון (correct winner/direction, wrong score)
   miss      = טעות  (wrong guess)
   Default sort: bull DESC, then direction DESC.                        */
export const ACCURACY = [
  { name: 'דן בן שימול', bull: 12, direction: 52, miss: 40 },
  { name: 'גיא אליהו',   bull: 12, direction: 49, miss: 43 },
  { name: 'לירון לברן',  bull: 11, direction: 54, miss: 39 },
  { name: 'איתי בכר',    bull: 11, direction: 51, miss: 42 },
  { name: 'דור סימוני',  bull: 11, direction: 45, miss: 48 },
  { name: 'אורן כהן',    bull: 10, direction: 53, miss: 41 },
  { name: 'עופר דהן',    bull: 10, direction: 52, miss: 42 },
  { name: 'אור קסלר',    bull: 10, direction: 52, miss: 42 },
  { name: 'תומר מור',    bull: 10, direction: 50, miss: 44 },
  { name: 'אלעד ירמיהו', bull: 9,  direction: 48, miss: 47 },
  { name: 'שחר גלר',     bull: 8,  direction: 46, miss: 50 },
  { name: 'ירדן אבישי',  bull: 7,  direction: 43, miss: 54 },
  { name: 'דור יאירי',   bull: 6,  direction: 44, miss: 54 },
  { name: 'עומר גלזר',   bull: 6,  direction: 39, miss: 59 },
  { name: 'אביעד צארום', bull: 4,  direction: 52, miss: 48 },
];

/* ── Section 3: pre-match bets ───────────────────────────────────────
   The 11 categories, in display order. `result` is the actual outcome
   that scored (shown as a sub-header row + column tooltip).            */
export const PREMATCH_CATEGORIES = [
  { key: 'topScorerA',  label: 'מלך שערים א',    result: 'אמבפה' },
  { key: 'topScorerB',  label: 'מלך שערים ב',    result: 'מסי' },
  { key: 'surprise',    label: 'המפתיעה',        result: 'מרוקו' },
  { key: 'finalistA',   label: 'פייליסטית א',    result: 'ארגנטינה' },
  { key: 'finalistB',   label: 'פייליסטית ב',    result: 'ספרד' },
  { key: 'yellow',      label: 'המוצהבת',        result: 'ארגנטינה' },
  { key: 'conceded',    label: 'הסופגת',         result: 'עיראק' },
  { key: 'disappoint',  label: 'המאכזבת',        result: 'גרמניה' },
  { key: 'fertileGroup',label: 'הבית הפורה',     result: "בית ט'" },
  { key: 'firstGroups', label: 'ראשון שלב בתים', result: 'דן בן שימול' },
  { key: 'lastGroups',  label: 'אחרון שלב בתים', result: 'דור יאירי' },
];

/* Per-player scored categories. Missing keys = empty cell ("–").
   `total` is the sum of the player's `values`.                         */
export const PREMATCH = [
  { name: 'לירון לברן',  total: 50, values: { topScorerA: 4, surprise: 10, yellow: 10, conceded: 5, disappoint: 10, fertileGroup: 6, lastGroups: 5 } },
  { name: 'תומר מור',    total: 49, values: { topScorerA: 4, surprise: 10, finalistB: 10, yellow: 10, conceded: 5, disappoint: 10 } },
  { name: 'אביעד צארום', total: 49, values: { topScorerB: 4, surprise: 10, finalistA: 10, yellow: 10, disappoint: 10, lastGroups: 5 } },
  { name: 'אורן כהן',    total: 40, values: { surprise: 10, finalistB: 10, yellow: 10, disappoint: 10 } },
  { name: 'עופר דהן',    total: 30, values: { finalistB: 10, yellow: 10, disappoint: 10 } },
  { name: 'שחר גלר',     total: 26, values: { surprise: 10, yellow: 10, fertileGroup: 6 } },
  { name: 'ירדן אבישי',  total: 26, values: { finalistB: 10, conceded: 5, fertileGroup: 6, firstGroups: 5 } },
  { name: 'איתי בכר',    total: 26, values: { surprise: 10, finalistB: 10, fertileGroup: 6 } },
  { name: 'דור סימוני',  total: 25, values: { topScorerA: 4, finalistB: 10, conceded: 5, fertileGroup: 6 } },
  { name: 'עומר גלזר',   total: 24, values: { topScorerA: 4, surprise: 10, finalistB: 10 } },
  { name: 'גיא אליהו',   total: 20, values: { topScorerA: 4, conceded: 5, fertileGroup: 6, firstGroups: 5 } },
  { name: 'אלעד ירמיהו', total: 20, values: { topScorerA: 4, finalistA: 10, fertileGroup: 6 } },
  { name: 'דור יאירי',   total: 20, values: { yellow: 10, disappoint: 10 } },
  { name: 'אור קסלר',    total: 14, values: { topScorerA: 4, surprise: 10 } },
  { name: 'דן בן שימול', total: 10, values: { finalistB: 10 } },
];
