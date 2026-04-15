# תוכנית — המשך עיצוב ונגישות מובייל

## Context

שלב 6.5 בתוכנית [ui-fix-plan-2026-04.md](c:/WORKSPACE/Shabi_Israel/docs/ui-fix-plan-2026-04.md) הסתיים: המרת table→cards ב-≤640px הוחלה על הטבלאות הראשיות (`#leagueTable`, `#playerTable`, `.completed-leagues-table`, `.admin-table`, `.dash-table`). Playwright אימת overflow=0 ב-375/414/768/1440 + zoom 1.5/2.

המשתמש שאל שתי שאלות:
1. **מה התכנון קדימה להמשך העיצוב?**
2. **האם הפרויקט נגיש כולו לדפדפן מובייל?**

התשובה הקצרה: **לא, עדיין לא כולו.** ה-CSS של ה-cards הוחל על כל selector-ים של `.dash-table` וכו', אבל `data-label` **לא** נוסף בכל ה-renderers. בנוסף, עמוד `player_general.html` לא טופל כלל. ועל המפה גם Step 7 (Editorial Chess) ו-Polish Phase Chunk 8 (themes redesign) שנדחו.

---

## חלק א׳ — השלמת נגישות מובייל (טקטי, ~3–4 שעות)

### בעיות שזוהו (מ-audit של Explore)

**High — עמוד dashboard.html:**
- **Rounds table** ב-[js/render/dashboardPage.js](c:/WORKSPACE/Shabi_Israel/js/render/dashboardPage.js) בפונקציה `drawRoundTable` (~שורה 953): 8 עמודות ללא `data-label`.
- **Remaining matches table** ב-`buildRemainingListHtml` (~שורה 1024): 4 עמודות ללא `data-label`.
- **Prizes table** ב-`.prizes-table` (~שורה 383): ללא `data-label`. גם יש `max-width: 400px` ב-[css/dashboard.css:501](c:/WORKSPACE/Shabi_Israel/css/dashboard.css#L501) — בפועל לא גולש כי card conversion דוחף ל-100%, אבל כדאי להסיר את ה-max-width.
- **What-If table** (`.whatif-table`, ~שורה 874): 7 עמודות ללא `data-label`.

> ה-CSS של `.dash-table` ב-[css/components.css:697-769](c:/WORKSPACE/Shabi_Israel/css/components.css#L697-L769) כבר ממיר את כל הטבלאות הללו ל-cards — רק ה-`data-label` חסרים. ללא labels, ה-`::before` נשאר ריק והמשתמש רואה ערכים בודדים ללא הקשר.

**Medium — עמוד player_general.html:**
אין בכלל card conversion ואין data-label:
- `.pg-rank-table` ב-[js/render/playerGeneralPage.js:334](c:/WORKSPACE/Shabi_Israel/js/render/playerGeneralPage.js#L334)
- `.pg-leagues-table` ב-`js/render/playerGeneralPage.js:433`
- `.pg-matches-table` ב-`js/render/playerGeneralPage.js:592`
- `.pg-mr-table` ב-`js/render/playerGeneralPage.js:729`
- CSS: [css/player-general.css](c:/WORKSPACE/Shabi_Israel/css/player-general.css) — אין `@media (max-width: 640px)`.

**Low:**
- [css/admin.css:614](c:/WORKSPACE/Shabi_Israel/css/admin.css#L614) — `.admin-sidebar` ב-82vw, עובד אבל snug.
- [css/theme-picker.css:41](c:/WORKSPACE/Shabi_Israel/css/theme-picker.css#L41) — `min-width: 220px` על הפאנל.

### מה צריך לעשות

1. **הוספת `data-label` ב-4 טבלאות של dashboard.js** — ~5 שורות לכל טבלה, עותק של התבנית שהוחלה בשלב 6.5 (מיפוי מ-columns array הקיים). Reuse של הדפוס מ-[js/render/dashboardPage.js](c:/WORKSPACE/Shabi_Israel/js/render/dashboardPage.js) ב-Top-5 שכבר הוטמע.
2. **הסרת `max-width: 400px`** מ-`.prizes-table` ב-[css/dashboard.css:501](c:/WORKSPACE/Shabi_Israel/css/dashboard.css#L501) — מיותר אחרי card conversion.
3. **הרחבת ה-card block ב-[css/components.css](c:/WORKSPACE/Shabi_Israel/css/components.css)** (או ב-[css/player-general.css](c:/WORKSPACE/Shabi_Israel/css/player-general.css)) לכלול `.pg-rank-table, .pg-leagues-table, .pg-matches-table, .pg-mr-table` תחת אותו `@media (max-width: 640px)` — reuse של אותו pattern.
4. **הוספת `data-label` ב-4 render functions ב-[js/render/playerGeneralPage.js](c:/WORKSPACE/Shabi_Israel/js/render/playerGeneralPage.js)**.
5. **אין שינוי ל-admin sidebar / theme-picker** — low severity, לא מצדיק שינוי עכשיו.

### Verification (Playwright MCP, theme יחיד)

- [ ] `scrollWidth === innerWidth` ב-375×812 על `dashboard.html` ו-`player_general.html`
- [ ] `getComputedStyle(td, '::before').content` לא ריק לדגימת תא נומרי בכל אחת מ-8 הטבלאות החדשות
- [ ] Desktop @1440 — כל הטבלאות נראות כרגיל, sticky עובד
- [ ] zoom 1.5 + 2 — אין overlap של תאים

---

## חלק ב׳ — כיוון עיצובי קדימה (אסטרטגי)

שלושה masa-ים פתוחים, לא קשורים זה לזה. דרוש החלטה של המשתמש לפני התחלה בכל אחד:

### 1. Step 7 — Editorial Chess (מ-[docs/ui-fix-plan-2026-04.md](c:/WORKSPACE/Shabi_Israel/docs/ui-fix-plan-2026-04.md))

**מה:** redesign מלא — טיפוגרפיה חדשה (Fraunces display + Inter Tight body), שינוי שמות themes ל-branding חדש, masthead header א-סימטרי.
**מצב:** blueprint כללי בלבד בתוכנית — קובץ `whimsical-noodling-graham.md` שהוזכר כ-plan מלא **לא קיים במאגר**. נדרש design session נפרד.
**סיכון:** גבוה — משנה את כל הזהות הוויזואלית.
**משך:** יומיים+.

### 2. Polish Phase Chunk 8 — Themes redesign session (מ-[docs/plans/polish-phase.md](c:/WORKSPACE/Shabi_Israel/docs/plans/polish-phase.md))

**מה:** session ייעודי להכרעה על צבעי placements בדשבורד הליגה, סגנון medal badges, והרמוניה חוצת-themes. כולל items פתוחים NEW-3 (dashboard colors), OLD-6 (themes), OLD-3 (visited-link styling).
**Themes קיימים:** 7 — dark, beige, nature, vegas, casino, rainbow, x22 (כולם CSS custom properties ב-[css/themes.css](c:/WORKSPACE/Shabi_Israel/css/themes.css)).
**סיכון:** בינוני — palette swaps בלבד, אין שינוי ארכיטקטורה.
**משך:** חצי יום–יום.

### 3. פריטים קטנים פתוחים מ-Polish Phase

- **NEW-9** — Chart axis legends/ticks (עיצוב axes בגרפים של player/dashboard)
- **NEW-11** — Date column על player cards (הוסף עמודת תאריך לטבלת matches)

**סיכון:** נמוך. **משך:** 1–2 שעות לכל אחד.

---

## המלצה — סדר ביצוע מוצע

1. **קודם** — חלק א׳ במלואו (3–4 שעות). סוגר את הפער של "נגישות מלאה במובייל" ומשלים את roadmap של ui-fix-plan-2026-04.
2. **אחר כך** — פריטי NEW-9 + NEW-11 הקטנים (3 שעות).
3. **החלטה שלך** — האם להתקדם ל-Chunk 8 themes redesign (חצי יום, סיכון בינוני) או ישר ל-Step 7 Editorial Chess (יומיים, סיכון גבוה, דורש brief נפרד).

הגישה הזאת שומרת על flow של "Mobile first ✅ → polish → redesign", ולא מערבבת תיקוני באגים עם שינויי זהות ויזואלית.

---

## קבצים קריטיים לעריכה (חלק א׳ בלבד)

| קובץ | שינוי |
|---|---|
| [js/render/dashboardPage.js](c:/WORKSPACE/Shabi_Israel/js/render/dashboardPage.js) | `data-label` ב-`drawRoundTable`, `buildRemainingListHtml`, prizes, what-if |
| [js/render/playerGeneralPage.js](c:/WORKSPACE/Shabi_Israel/js/render/playerGeneralPage.js) | `data-label` ב-`renderRankTable`, `renderLeaguesTable`, `renderMatchesTable`, `renderMatchRecords` |
| [css/components.css](c:/WORKSPACE/Shabi_Israel/css/components.css) | הרחבת `@media (max-width: 640px)` לכלול `.pg-*-table` |
| [css/dashboard.css](c:/WORKSPACE/Shabi_Israel/css/dashboard.css) | הסרת `max-width: 400px` מ-`.prizes-table` |
| [docs/ui-fix-plan-2026-04.md](c:/WORKSPACE/Shabi_Israel/docs/ui-fix-plan-2026-04.md) | הוספת "שלב 6.6 — השלמת mobile לעמודים משניים" עם סטטוס |
