# סטטוס מימוש טבלאות MF — 2026-05-11

נקודת ציון לפני המשך עבודה על איחוד טבלאות תחת `table-lab/`.

---

## איפה אנחנו עומדים כרגע

### טבלאות MF שכבר עוברות דרך הקנון `mountMFTable`

| טבלה | קובץ | מתי |
|---|---|---|
| C1 — Leagues (player-general) | `js/render/playerGeneralPage.js:479` | ✅ ב-HEAD (commit `43a9884`) |
| C2 — Match History | `js/render/playerGeneralPage.js:593` | ✅ ב-HEAD |
| C3 — Matchup | `js/render/playerGeneralPage.js:795` | ✅ ב-HEAD |
| D — League Table | `js/render/leaguePage.js:92` | ✅ ב-HEAD |
| E — Player Match History | `js/render/playerPage.js:125` | ✅ ב-HEAD |
| A1 — Completed Leagues | `js/render/landingPage.js:819` | ⚠️ uncommitted (אחרי HEAD) |
| A2 — Annual Leaderboards | `js/render/landingPage.js:1017` | ⚠️ uncommitted (אחרי HEAD) |

### טבלאות MF שעדיין hand-built (לא דרך הקנון)

כל ה-B-series ב-`dashboard.html`. כולן מתויגות ב-`data-mf-table-id="B*"` אבל ה-DOM נבנה בידיים ב-`js/render/dashboardPage.js`:

- B1 Prizes & Medals
- B2 Historical view
- B3 Championship Predictor
- B4 What If Simulator
- B5 Rounds
- B6a All Remaining
- B6b Remaining Per Player
- B6c Unplayed Opponents

**יחס:** 7 / 15 MF tables עוברות דרך הקנון (~47%). 8 / 15 (B-series) — עדיין hand-built.

### CSS — מצב נוכחי (אחרי תיקון הפינות החדות היום)

- `css/components.css` — `.mf-wrap` עכשיו תואם ל-spec של [docs/TABLE-DESIGN.md](../TABLE-DESIGN.md): פינות חדות + `box-shadow: var(--shadow-sm)`. בלי `border-radius`, בלי `shadow-md`.
- `table-lab/lab.css` — `.mf-wrap` תואם, ה-lab מציג עכשיו פינות חדות.
- שני ה-wrappers החיצוניים ב-`css/player-general.css` (`.pg-leagues-table-wrapper`, `.pg-matches-table-wrapper`) רוקנו — הקארד-ויזואל יושב על `.mf-wrap` הפנימי.

### החלטה ויזואלית שנעולה

**הלאב הוא ה-spec הוויזואלי.** כל מה שמופיע ב-`table-lab/` נחשב נכון. כל סטייה בפרודקשן מהלאב = באג בפרודקשן, לא בלאב.

---

## למה אנחנו עושים את זה — המוטיבציה

טבלאות בפרויקט מתפזרות היום בין:
1. **רינדור hand-built** (B-series, F-series אדמין) — קונקטנציה של מחרוזות HTML בתוך מודולי render.
2. **רינדור דרך `mountMFTable`** (7 הטבלאות שלמעלה).
3. **CSS דואלי** — חוקי טבלה ב-`css/components.css` *וגם* ב-`table-lab/lab.css`, עם דריסות בעייתיות (כמו ה-`border-radius` שגרם לפינות עגולות לא רצויות).

זה גורם ל:
- שכפול קוד (hand-built HTML חוזר על עצמו, לעיתים עם הבדלים קטנים שגוררים באגים).
- דריפט עיצובי (טבלה אחת מקבלת fix של עיצוב, אחרות לא).
- קושי בתחזוקה (לעדכן עמודה דורש עריכת string concatenation במקום ערוך JSON).
- ה-lab לא באמת עצמאי — הוא תלוי ב-`css/components.css` של הפרויקט, ולכן שינויים בפרודקשן שוברים את הלאב (וההפך).

המטרה: **הלאב הופך למקור היחיד לכל הטבלאות. הפרויקט צורך מהלאב, לא יוצר טבלאות בעצמו.**

---

## מה רוצים להגיע אליו בסופו של דבר

קוד נקי, מודולרי, ללא שכפול, יעיל — מובנה סביב 5 פורמטים:

| Format | קוד | תיאור | טבלאות |
|---|---|---|---|
| **MF** (Main Format) | `mountMFTable` | טבלת סטטיסטיקה רגילה עם sticky cols, medals, sort | A1, A2, all B, C1, C2, C3, D, E |
| **SF** (Secondary Format) | `mountSFTable` | טבלאות records / leaderboards-snippets קומפקטיות | A3, A4, A5, A6, C4 |
| **exp** (Expandable) | `mountExpTable` | שורות מתפרשות / תוכן מתקפל | C0 |
| **FF1** (Form Format 1) | `mountFF1Table` | League Manager — CRUD inline | F1 |
| **FF2** (Form Format 2) | `mountFF2Table` | Round Editor — score entry | F2 |

מבנה התיקיות ב-end-state:

```
table-lab/
├── formats/
│   ├── _base/base.css         ← כללי CSS משותפים לכל הפורמטים
│   ├── mf/{mount.js,mf.css}
│   ├── sf/{mount.js,sf.css}
│   ├── exp/{mount.js,exp.css}
│   ├── ff1/{mount.js,ff1.css}  (Phase 8, אופציונלי)
│   └── ff2/{mount.js,ff2.css}  (Phase 8, אופציונלי)
├── presets/                   ← preset לכל טבלה ספציפית (a1, a2, b1, ... f2)
├── lab-loader.js              ← קורא דאטה אמיתי ומכין presets
├── index.html                 ← טאב לכל טבלה — הלאב כקטלוג מלא
└── lab.css                    ← רק chrome של הלאב, לא CSS של טבלאות
```

`css/components.css` יכיל רק:
- **Group B** (atomic shared components: `.flag`, `.medal`, `.league-type-pill`, `.status-pill`, `.title-abbr*`, וכו')
- **Group C** (UI לא-טבלאית: focus-visible, chart-panel, matchup card chrome, וכו')

`js/render/*.js` יכיל רק orchestration — data → preset → `mountXTable()`. אפס concatenation של HTML טבלאי.

---

## הדרך לשם — תכנית מפורטת

**מסמך התכנית המלא:** [docs/plans/table-lab-unification.md](table-lab-unification.md)

שלבי הביצוע (סיכום):

| Phase | מה | מגע ב-`components.css`? |
|---|---|---|
| Pre-flight | פתרון 6 דלתאות לא-מקומיטות (הוחלט: "כמו בלאב") | לא |
| 1 | השלמת קטלוג MF בלאב — מילוי הפער של B1–B6c | לא |
| 2 | יצירת `formats/_base/base.css` ו-`formats/mf/mf.css` (העתקה, לא הזזה) + הזזת `mountMFTable` ללאב | לא |
| 3 | הפרודקשן טוען גם את CSS של הלאב + מייבא משם את ה-JS | לא (רק הוספת `<link>`) |
| 4 | ניקוי JS — הסרת shims והסרת hand-built MF | לא |
| 5 | מימוש SF בלאב (A3, A4, A5, A6, C4) | לא |
| 6 | מימוש exp בלאב (C0) | לא |
| 7 | חיבור SF + exp בפרודקשן, **grep gate**, **מחיקת Group A מ-`components.css`** | ✅ רק כאן |
| 8 | FF1 + FF2 (אדמין, אופציונלי) | לא |
| 9 | ניקוי סופי | לא |

`components.css` נשאר ללא שינוי לאורך שלבים 1–6. רק ב-Phase 7, אחרי שכל הפורמטים נעולים בלאב והפרודקשן עובד נגדם, מוחקים את Group A. הסיכון נמוך כי לפני המחיקה יש grep gate שמוודא שכל סלקטור שמוסר מכוסה במקור חלופי בלאב.

---

## הצעד הבא כשתחזור אל זה

1. עבור על ה-PLAN המלא ב-[docs/plans/table-lab-unification.md](table-lab-unification.md).
2. החלט אם להתחיל ב-**Phase 1** (השלמת ה-B-series ב-lab — `buildB1`...`buildB6c` ב-`lab-loader.js`).
3. אחרי שכל הטאבים בלאב מציגים את ה-B-series כראוי → להמשיך ל-Phase 2 (פיצול ה-CSS לשכבת base + mf).

זוהי עבודה additive בלבד עד Phase 7 — בטוח לעצור באמצע ולחזור אחרי כמה ימים.

---

## קבצים מרכזיים לזכור

- **המסמך הזה** (סטטוס): `docs/plans/table-lab-status-2026-05-11.md`
- **תכנית מלאה:** [docs/plans/table-lab-unification.md](table-lab-unification.md)
- **ה-spec של הפורמטים:** [docs/TABLE-DESIGN.md](../TABLE-DESIGN.md)
- **הקנון הקיים:** [js/render/mountMFTable.js](../../js/render/mountMFTable.js)
- **הלאב:** [table-lab/index.html](../../table-lab/index.html), [table-lab/lab-loader.js](../../table-lab/lab-loader.js), [table-lab/lab.css](../../table-lab/lab.css)
- **CSS לפיצול עתידי:** [css/components.css](../../css/components.css)
