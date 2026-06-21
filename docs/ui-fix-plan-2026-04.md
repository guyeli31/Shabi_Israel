# תוכנית עבודה — תיקוני UI/UX

**תאריך:** 2026-04-14
**מקור הממצאים:** [docs/ui-audit-2026-04.md](ui-audit-2026-04.md)
**עיקרון:** כל שלב עצמאי, מסתיים במצב יציב שניתן להתרשם ממנו בדפדפן לפני המעבר לשלב הבא.

---

## איך לעבוד עם התוכנית הזו

1. פתח שיחה חדשה עם Claude Code.
2. אמור: "בצע שלב N מ-[docs/ui-fix-plan-2026-04.md](docs/ui-fix-plan-2026-04.md)".
3. Claude יבצע את השלב, יבדוק אותו, ויעצור. אתה מתרשם בדפדפן.
4. כשמוכן לשלב הבא — חוזר על אותו הדבר עם N+1.

**שרת מקומי:** `npx http-server -p 3000 --cors -c-1` (נמל 3000, לא 8080).
**אימות:** admin/admin123.

---

## Skills — שימוש חובה בכל שלב

כל שלב חייב לנצל את ה-skills הרלוונטיים. **אל תיישם "בעיניים" — השתמש ב-skill המתאים לכל תת-משימה.**

| Skill | מתי להשתמש | שלבים רלוונטיים |
|---|---|---|
| **`Playwright MCP`** | אימות ויזואלי + מדידה: screenshots לפני/אחרי, `browser_evaluate` לבדיקות DOM (scrollWidth, getBoundingClientRect, axe.run()), resize ל-viewports, navigation בין עמודים, console logs. **הכלי היחיד שמאמת שהתיקון באמת עובד.** | **כל השלבים 1–6** (חובה ב-verification gates) |
| **`frontend-design`** | כל בחירה עיצובית — typography, color tokens, spacing, motion, aesthetic direction. מחייב "bold intentional direction" ולא ברירות מחדל גנריות. | שלב 4 (contrast/tokens), שלב 5 (drawer motion+composition), שלב 7 (Editorial Chess — כל הדרך) |
| **`design-review`** | ביקורת multi-phase על פי Stripe/Airbnb/Linear: interaction flows → responsiveness → visual polish → a11y → robustness → code health. חובה כ-sanity check אחרי שלבים שמשנים הרבה. | אחרי שלב 2 (sticky), אחרי שלב 4 (gate), אחרי שלב 6 (final polish) |

### איך להפעיל בשיחה
- `frontend-design` — מופעל אוטומטית כשמבקשים עבודת frontend; אפשר לבקש מפורשות: "השתמש ב-frontend-design skill".
- `Playwright MCP` — דורש restart של Claude Code ואישור הרשאות לפני השימוש הראשון. הפקודות: `mcp__playwright__browser_navigate`, `browser_resize`, `browser_take_screenshot`, `browser_evaluate`, `browser_click`, `browser_snapshot`.
- `design-review` — workflow שיש להריץ כ-review מובנה; לבקש מפורשות: "הרץ design-review על השינויים".

### מיפוי skill ↔ שלב

- **שלב 1 (Quick wins):** Playwright — screenshot לפני, תיקון, screenshot אחרי, `browser_evaluate` לאימות `scrollWidth === innerWidth` ו-`font-size ≥ 16px`.
- **שלב 2 (Sticky):** Playwright — גלילה לתחתית הטבלה + מדידת `getBoundingClientRect().top` של avg/stat rows, ב-3 themes × 2 viewports.
- **שלב 3 (a11y batch):** Playwright — הזרקת axe-core + `axe.run()`, בדיקת Tab-order, וידוא `th[scope]` + `.skip-link` ב-DOM.
- **שלב 4 (Contrast):** frontend-design לבחירת הטוקנים החדשים (לא "בעיניים" — בחירה מכוונת פר theme) + Playwright לאימות axe 0 violations + design-review אחרי לוודא שה-aesthetic לא נפגע.
- **שלב 5 (Drawer):** frontend-design ל-motion/composition של ה-drawer + Playwright לבדיקת focus trap, Esc, tap-outside, transform transitions.
- **שלב 6 (Mobile polish):** Playwright למדידת touch targets ב-4 viewports + screenshot של theme picker עם safe-area.
- **שלב 7 (Editorial Chess):** frontend-design מוביל את הכל + design-review בסוף.

### חובות לכל שלב
1. **לפני השינוי** — Playwright screenshot + metrics (baseline).
2. **אחרי השינוי** — Playwright screenshot + metrics (proof).
3. **ה-verification gate רץ דרך Playwright**, לא "הסתכלתי ונראה טוב".
4. אם השלב משנה aesthetic (2, 4, 5, 7) — design-review workflow בסוף.

---

## שלב 1 — Quick wins (15 דק')

**מטרה:** שלושה תיקונים טריוויאליים שמשחררים בדיקות מובייל ומתקנים semantics.

### משימות
1. **C2 — Horizontal overflow ב-index.html @ 375**
   - לעטוף את `.completed-leagues-table` ב-`<div class="table-scroll">` ב-[index.html](../index.html) (או ברכיב ה-render המתאים ב-[js/render/landingPage.js](../js/render/landingPage.js)).
   - וידוא: `document.documentElement.scrollWidth === window.innerWidth` ב-375px.

2. **C5 — iOS input zoom**
   - ב-[css/navigation.css](../css/navigation.css) (או איפה שה-search input מוגדר), שינוי `font-size` ל-**16px** על inputs focusable.
   - אם 16px פוגע בעיצוב — `transform: scale(0.7); transform-origin: left center;` כפיצוי ויזואלי.

3. **H4 — `lang`/`dir` mismatch**
   - שינוי `<html lang="he" dir="ltr">` ל-`<html lang="en" dir="ltr">` בכל קבצי ה-HTML ([index.html](../index.html), [league_table.html](../league_table.html), [player_league.html](../player_league.html), [player.html](../player.html), [league.html](../league.html), [admin.html](../admin.html)).

### בדיקה ידנית
- פתח index.html @ 375 — אין scroll אופקי.
- פתח באייפון (או DevTools iOS simulator) — tap על search input לא מזגג.
- View source — `lang="en"` בכל העמודים.

### Verification gate
- [ ] `scrollWidth === innerWidth` ב-index.html @ 375
- [ ] כל ה-inputs עם `font-size ≥ 16px`
- [ ] `lang="en"` בכל 6 העמודים

---

## שלב 2 — תיקון sticky avg/stat rows (C1)

**מטרה:** שורות ה-Averages ו-Stats נצמדות לתחתית הטבלה בגלילה — גם בדסקטופ וגם במובייל.

### משימות
1. עריכת [css/components.css:155-189](../css/components.css#L155-L189):
   - הסרת `position: sticky` מה-`tr.avg-row` וה-`tr.stat-row`.
   - הוספה ל-`tr.avg-row td` ו-`tr.stat-row td` במקום:
     ```css
     tr.avg-row td {
         position: sticky;
         bottom: 30px; /* גובה stat-row */
         z-index: 2;
         background: var(--color-avg-bg);
         /* שאר ה-styling */
     }
     tr.stat-row td {
         position: sticky;
         bottom: 0;
         z-index: 2;
         background: var(--color-surface);
     }
     ```
2. **M5** — להחליף את `bottom: 30px` הקשיח ב-CSS variable (`--stat-row-height`) שיוכל להתעדכן דינמית אם הטיפוגרפיה משתנה.

### בדיקה ידנית
- פתח [league_table.html](../league_table.html?league=Shabi%20Israel%20April%202026) בדסקטופ + מובייל (375).
- גלול את הטבלה לתחתית.
- **ציפייה:** avg-row + stat-row נשארים נעוצים מעל התחתית, גלויים.

### Verification gate
- [ ] avg-row `getBoundingClientRect().top < innerHeight - 50` כשגוללים לסוף
- [ ] stat-row `getBoundingClientRect().top < innerHeight - 20` כשגוללים לסוף
- [ ] עובד בכל 3 ה-themes (current/dark/vegas)
- [ ] עובד גם בליגות Regular + UBC (לא רק Doubling)

---

## שלב 3 — a11y batch (H2 + H3 + H5)

**מטרה:** ניווט מקלדת + screen readers עובדים סוף-סוף.

### משימות
1. **H2 — `scope="col"` על כל `<th>`**
   - עריכת כל הרכיבים ב-[js/render/](../js/render/) שמייצרים `<th>`: [leaguePage.js](../js/render/leaguePage.js), [playerPage.js](../js/render/playerPage.js), [landingPage.js](../js/render/landingPage.js), [dashboardPage.js](../js/render/dashboardPage.js) וכו'.
   - להוסיף `th.scope = 'col'` בכל יצירת `<th>`.

2. **H3 — skip-to-main-content link**
   - הוספה ל-[js/render/navigation.js](../js/render/navigation.js): `<a class="skip-link" href="#main">Skip to content</a>` כאלמנט ראשון.
   - CSS ל-[css/navigation.css](../css/navigation.css):
     ```css
     .skip-link {
         position: absolute; top: -100px; left: 0;
         background: var(--color-primary); color: #fff;
         padding: 8px 16px; z-index: 9999;
     }
     .skip-link:focus { top: 0; }
     ```
   - ודא ש-`<main id="main">` קיים בכל העמודים.

3. **H5 — `:focus-visible` גלובלי**
   - ב-[css/components.css](../css/components.css) או [css/variables.css](../css/variables.css):
     ```css
     :focus-visible {
         outline: 2px solid var(--color-accent);
         outline-offset: 2px;
         border-radius: 2px;
     }
     button:focus-visible, a:focus-visible, input:focus-visible,
     th[role="columnheader"]:focus-visible { /* ... */ }
     ```

### בדיקה ידנית
- Tab מההתחלה של index.html — שלב ראשון הוא ה-skip-link (מופיע למעלה).
- Enter על skip-link → קופץ לטבלה.
- Tab דרך sortable headers — outline גלוי.
- Tab דרך כפתורים/קישורים — outline גלוי.
- DevTools Accessibility tree → כל table headers עם `role="columnheader"`.

### Verification gate
- [ ] `document.querySelectorAll('th[scope="col"]').length > 0` בכל עמוד עם טבלה
- [ ] `document.querySelector('.skip-link')` קיים בכל עמוד
- [ ] Tab מציג outline גלוי על כל element focusable

---

## שלב 4 — Contrast audit + fix (C3)

**מטרה:** 0 serious/critical violations ב-axe-core בכל theme.

### משימות
1. **מדידה לפני תיקון**
   - הרצת axe-core על index/league/player ב-3 themes → רשימה של exact failing nodes.
   - זיהוי ה-CSS variables הבעייתיים (חשודים: `--color-text-muted`, `--color-text-secondary`, `color-scaled` green/red).

2. **תיקון ב-[css/variables.css](../css/variables.css)**
   - עיבוי `--color-text-muted` לניגודיות ≥ 4.5:1 מול `--color-surface`.
   - בדיקת כל theme ב-[css/themes.css](../css/themes.css) בנפרד — כל theme צריך overrides משלו אם ה-base לא מספיק.

3. **תיקון של `color-scaled`**
   - ערכי Win Rate/PR/Luck הצבועים ירוק/אדום — גוונים עמוקים יותר, או background chip במקום foreground-only.
   - לשקול שימוש ב-`filter: var(--color-scale-filter)` עם ערכים חזקים יותר.

4. **badges על רקעים צבועים**
   - status-pill, medal, title-abbr — בדיקה פר-theme.

### בדיקה ידנית
- הרץ axe-core שוב → 0 serious/critical.
- עין אנושית: הסתכל על כל 3 ה-themes, בפרט vegas/rainbow — האם טקסט קריא?
- בדוק dark theme — אל תפגע ב-look.

### Verification gate
- [ ] `axe.run()` מחזיר 0 violations ברמה serious או critical
- [ ] כל עמוד × 3 themes × 2 viewports (12 בדיקות)
- [ ] ה-themes עדיין נראים טוב ויזואלית (לא נפגעו)

---

## 🛑 **עצירת ביניים — ה-Audit Gates עוברים**

אחרי שלב 4 הסקירה המקורית מוכרזת "נקייה": אין critical violations, אין overflow, sticky עובד, keyboard accessible. **מכאן והלאה זה שדרוג, לא fix.** כדאי לעצור ולהחליט אם להמשיך.

---

## שלב 5 — Admin hamburger drawer (C4)

**מטרה:** admin.html שמיש במובייל.

### משימות
1. יצירת [js/admin/adminDrawer.js](../js/admin/) — component חדש:
   - כפתור ☰ למעלה-שמאל (גלוי רק < 768px).
   - Drawer עם `transform: translateX(-100%)` → `0` ב-200ms.
   - Backdrop שחור שקוף (`rgba(0,0,0,0.5)`).
   - Focus trap + Esc + tap-outside לסגירה.
2. CSS ב-[css/admin.css](../css/admin.css):
   ```css
   @media (max-width: 767px) {
       .admin-sidebar {
           position: fixed; top: 0; left: 0;
           transform: translateX(-100%);
           transition: transform 200ms ease-out;
           z-index: 100;
       }
       .admin-sidebar.open { transform: translateX(0); }
       .admin-hamburger { display: block; }
   }
   @media (min-width: 768px) {
       .admin-hamburger { display: none; }
   }
   ```
3. עריכת [admin.html](../admin.html) — הוספת כפתור ה-hamburger.

### בדיקה ידנית
- admin.html @ 375 — sidebar מוסתר, כפתור ☰ גלוי.
- Tap על ☰ → drawer נפתח מהצד.
- Esc/tap-outside → נסגר.
- admin.html @ 1440 — sidebar רגיל, בלי hamburger.

### Verification gate
- [ ] admin.html viewport height פנוי > 80% במובייל (לא כמו 45.8% של ה-sidebar הישן)
- [ ] Desktop unchanged
- [ ] Focus trap עובד

---

## שלב 6 — Mobile polish (H6)

**מטרה:** חוויית מובייל מלוטשת.

### משימות
1. **H1 — Touch targets ≥ 44×44px** — ❌ בוטל (המשתמש ביקש לוותר על השינוי הזה).

2. **H6 — Floating buttons safe-area**
   - [theme-picker.css](../css/theme-picker.css): `bottom: calc(16px + env(safe-area-inset-bottom));`
   - אותו דבר ל-admin button אם יש.
   - ב-[index.html](../index.html) (ועוד) `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

3. **H7 — Hide empty Date column** — ❌ בוטל (המשתמש ביקש לוותר על השינוי הזה).

### בדיקה ידנית
- theme picker לא נחסם ע"י Safari URL bar.

### Verification gate
- [ ] theme picker גלוי מעל iOS Safari URL bar

---

## שלב 6.5 — Mobile layout + zoom fix (C6 + C7)

> 🔄 **הוחלף (2026-04-16)** — הגישה של CSS-only **card conversion** (table→cards ב-≤640px) הוטמעה ואומתה אבל נדחתה ע"י המשתמש שהגדיר אותה כ"עיוות". הדרישה המעודכנת: הטבלאות במובייל חייבות להישאר **מטריצה** כמו בדסקטופ. **ראה שלב 6.6** למטה ו-[docs/mobile-design-roadmap-2026-04.md](mobile-design-roadmap-2026-04.md) לפרטים מלאים.

**מטרה:** טבלאות במובייל ברוחב מלא של המסך כברירת מחדל, ללא scroll אופקי, ללא שבירת פריסה בזמן pinch-zoom.

### גבולות scope (חובה)
- **Theme יחיד** — verification רץ רק על ה-theme הנוכחי/ברירת מחדל. המשתמש מרוצה מהניגודיות והצבעים בכל ה-themes; אין לחזור על הבדיקות פר-theme.
- **מיקוד:** (א) פריסת entities במובייל, (ב) הגדלים שלהן, (ג) השפעת pinch-zoom in/out על הפריסה. שום דבר אחר.
- **מחוץ ל-scope:** contrast, צבעים, typography, a11y מעבר למה שכבר נעשה בשלבים 1–6, וכן tablet (641–768px) — הבאג של sticky+zoom שם נשאר כידוע, תיקון טלפון בלבד.

### בעיות שנחשפו ע"י המשתמש (צילומי מסך מובייל)
1. **טבלאות לא ברוחב מלא** — [#leagueTable](../css/components.css#L84-L145) ו-[#playerTable](../css/components.css#L147-L195) משתמשות ב-`.table-scroll` עם עמודות ברוחב קבוע (`56px` rank, `180px` player, `44px` games…). ב-375px הטבלה רחבה מהמסך, המשתמש רואה טבלה חתוכה עם גלילה.
2. **pinch-zoom שובר את הפריסה** — `position: sticky; left: 0` על עמודות 1–2 מתנגש עם iOS Safari zoom: התאים הדביקים מתנתקים / overlap-ים עם עמודות נומריות.
3. **scrollbars קצרים** — כאשר scroll container קיים, ה-scrollbar לא תופס את כל רוחב/גובה ה-card.

### אסטרטגיה — CSS-only "table → cards" ב-≤640px

המרת ה-DOM של הטבלה הקיימת ל-layout מוערם במובייל באמצעות **CSS טהור** (`display: block` על `tr`, `td`, `thead`, + `::before` pseudo labels ממקור `data-label`). ללא JS rebuild, ללא DOM כפול, ללא פיצול render-path. Desktop מציג טבלה רגילה; אותו HTML זורם ל-cards מתחת ל-breakpoint.

**למה CSS-only ולא JS rebuild:**
- sorting, What-If simulator, color-scale, export-image, medal logic — הכל נשאר על אותם `<tr>` / `<td>`.
- אפס סיכון regression בכל 3 סוגי הליגות (doubling / regular / ubc) כי ה-columns array לא משתנה.
- source של אמת אחד.

**שינוי JS יחיד נדרש:** הוספת `data-label="<col title>"` על כל `<td>` ב-render functions כדי ש-CSS יוכל להראות labels דרך `::before`. כ-5 שורות לכל קובץ render.

### Breakpoint
`@media (max-width: 640px)` — מתחת ל-`768px` הקיים של tablets, כך ש-iPad portrait עדיין רואה טבלה.

### פריסת Card (לכל `<tr>`)
```
┌─────────────────────────────────┐
│ [medal]  🇮🇱 PlayerName         │   ← header strip (Rank + Player)
├─────────────────────────────────┤
│ Games        22                 │
│ Wins         16                 │
│ Win Rate    72.73%              │   ← label-value דרך ::before
│ Mean PR      6.62               │
│ Luck         +1.34              │
└─────────────────────────────────┘
```
`tr.avg-row` הופך ל-card מלא של "AVERAGES"; `tr.stat-row` הופך לקו caption מתחת לרשימה.

### משימות

1. **[css/components.css](../css/components.css)** — הוספת בלוק `@media (max-width: 640px)` בסוף הקובץ:
   - `display: block` על `#leagueTable`, `#playerTable`, `#leagueTable thead`, `tbody`, `tr`, `td`.
   - `position: static !important; left: auto !important` על עמודות sticky 1–2 + `thead` — **מתקן את באג ה-zoom של iOS כ-side effect**.
   - `td::before { content: attr(data-label); }` layout של label-value בתוך כל td.
   - תגי medal + color-scaled נשמרים (inline color, border-left accent מ-`.rank-gold` וכו').

2. **[css/layout.css](../css/layout.css)** — `.page-container` padding של `0 var(--space-sm)` ב-≤640px כדי שה-cards יוכלו להגיע edge-to-edge.

3. **JS — הוספת `data-label` על כל `<td>`** בקבצים הבאים (מקור הערך: `col.title` מתוך ה-columns array הקיים מ-[compute/leagueTypes.js](../js/compute/leagueTypes.js)):
   - [js/render/leaguePage.js](../js/render/leaguePage.js) — `renderDataRows` (~231–288), `renderAverageRow` (~293–321), ענף unplayed.
   - [js/render/playerPage.js](../js/render/playerPage.js) — תאי `#playerTable`.
   - [js/render/dashboardPage.js](../js/render/dashboardPage.js) — מיני-טבלת Top 5.
   - [js/render/landingPage.js](../js/render/landingPage.js) — `.completed-leagues-table`.
   - ה-admin leagues table (הטבלה בצילום 1 שגולשת).

4. **Scrollbar framing audit** — grep `overflow-x: auto` / `overflow-y: auto` בכל `css/`, לוודא שה-parent של כל container כזה הוא `width: 100%` / `height: 100%`, כך ש-scrollbar tracks נפרסים במלוא ה-card.

### Verification gate (Playwright MCP, theme יחיד)

Viewports: **375×812, 414×896, 768×1024, 1440×900**.
Pages: index.html, league_table.html, player_league.html, league.html, admin.html → Leagues.

- [ ] `document.documentElement.scrollWidth === window.innerWidth` ב-375px בכל העמודים
- [ ] כל שורה ב-`#leagueTable` / `#playerTable` ב-375px היא card ברוחב מלא (בדיקה: `tr.getBoundingClientRect().width === main.clientWidth - padding`)
- [ ] `getComputedStyle(td, '::before').content` לא ריק עבור דוגמת תא נומרי (ווידוא שה-`data-label` קיים ומוצג)
- [ ] `document.body.style.zoom = 1.5` → screenshot → אין cells שעוברים אחד על השני; Rank/Player לא דביקים עוד
- [ ] `document.body.style.zoom = 2` ואז חזרה ל-`1` → הפריסה זהה למצב ההתחלתי (אין תאים תקועים)
- [ ] scroll containers (אם נשארו) — `scrollWidth` של ה-track = `clientWidth` של ה-card
- [ ] Desktop @ 1440×900 — טבלאות נראות רגיל, sticky עובד, אין regression ויזואלי
- [ ] **רק ה-theme הנוכחי נבדק** (לא לעבור בין themes)

### משך משוער
~4–6 שעות: 1ש' CSS card layout, 1ש' `data-label` wiring ב-4 קבצי render, 1ש' scrollbar audit + layout.css, 1–2ש' Playwright verification + edge cases (avg-row, stat-row, colspans).

---

## שלב 6.6 — Mobile Matrix + Compression ✅ (2026-04-16)

**Status:** ✅ הושלם, branch `mobile-matrix-v2`.
**Roadmap:** [docs/mobile-design-roadmap-2026-04.md](mobile-design-roadmap-2026-04.md).

### מה בוצע
- **A** — הוסרו כל כללי ה-card conversion מ-[css/components.css](../css/components.css) (`@media (max-width: 640px)` ~280 שורות).
- **B** — דחיסה: `font-size: 0.7rem`, `padding: 2-3px`, `white-space: nowrap` על כל 9 selectors של טבלאות במובייל.
- **C** — Dual-label pattern: `<span class="th-full">Win Rate</span><span class="th-abbr">WR%</span>` עם CSS swap. Helper `thLabel()` ב-[js/utils/helpers.js](../js/utils/helpers.js). הוחל על 5 קבצי render (leaguePage, playerPage, dashboardPage, playerGeneralPage, landingPage) + admin leagues inline.
- **D** — Conditional sticky על Rank+Player ב-`#leagueTable` ו-`#playerTable` (thead+tbody, `background: var(--header-bg)` לכותרת, `var(--color-surface)` לגוף, `z-index: 4/2`).
- **E** — `pg-leagues-table`: סידור Rank מעמודה 9 לעמודה 4 (desktop + mobile); wrapper חדש `.pg-leagues-table-wrapper` עם `overflow-x: auto`; עמודה 1 (League) sticky עם `box-shadow` אינדיקציה.
- **F** — `pg-matches-table`: cap של 25 שורות במובייל + כפתור "Show all N matches" שמתחלף ל-"Show only 25". Chart `.bar-chart-canvas` קיבל `max-width: 100%; height: auto`.
- **G** — dash-table: הוסר `max-width: 400px` מ-`.prizes-table`, נוספה דחיסה מובייל לכל הטבלאות ב-[css/dashboard.css](../css/dashboard.css); `.leaderboard-table`, `.achv-table`, `.completed-leagues-table` ב-[css/index-dashboard.css](../css/index-dashboard.css).
- **I** — עדכון המסמך הזה.

### Playwright verification (2026-04-16)

| viewport | page | docScrollWidth | תוצאה |
|---|---|---|---|
| 375×812 | league_table.html | 360 | ✅ 9 cols fit (tableScroll=352, wrap=352) |
| 375×812 | player_league.html | 360 | ✅ 7 cols fit (352/352), sticky header רקע תקין |
| 375×812 | index.html | 360 | ✅ `.completed-leagues-table` 352/352, `.leaderboard-table` 338/338 |
| 375×812 | league.html | 360 | ✅ Top-5, Round, What-If 352/352 |
| 375×812 | player.html | 360 | ✅ pg-leagues scrolls פנימית (383/352), pg-matches 117 מוסתרות/142 סה"כ, chart 352 |
| 414×896 | league_table.html | 414 | ✅ 9 cols fit (406/406) |
| 576×900 | league_table.html (≡ zoom 2.5× @ 1440) | 576 | ✅ mobile mode engaged, 568/568 |
| 720×900 | league_table.html (≡ zoom 2.0× @ 1440) | 705 | ⚠ tablet mode (mexpected), wrapper scrolls internally |
| 768×1024 | league_table.html | 753 | ✅ dual-label swaps back to full labels (desktop) |

- [x] Dual-label: `.th-full display:none`, `.th-abbr display:inline` @ ≤640px; מתהפך @ ≥641px.
- [x] Expand button: click → 117 hidden rows reveal, text updates to "Show only 25".
- [x] Sticky header bg fix: ראיתי ש-`var(--color-surface)` הלבן דרס את ה-header הכהה של עמודת Opp; תוקן על-ידי פיצול לכללי thead (`--header-bg`) ו-tbody (`--color-surface`) נפרדים.
- [x] Screenshot evidence: `.playwright-mcp/step6.6-league-375-fixed.png`, `.playwright-mcp/step6.6-player-375-fixed.png`, `.playwright-mcp/step6.6-pg-375.png`.

### קבצים שהשתנו
- [css/components.css](../css/components.css) — מחיקת ~280 שורות card CSS, החלפה ב-~140 שורות compression + conditional sticky + dual-label swap.
- [css/dashboard.css](../css/dashboard.css) — הסרת `max-width: 400px`, הוספת mobile compression ל-`.dash-table`.
- [css/player-general.css](../css/player-general.css) — ~100 שורות: `.pg-leagues-table-wrapper`, sticky League column, matches cap rows, chart max-width, grid 1-col, tiles 2-col.
- [css/index-dashboard.css](../css/index-dashboard.css) — mobile compression ל-`.leaderboard-table`, `.achv-table`, `.completed-leagues-table`, `.pdf-export-btn`.
- [js/utils/helpers.js](../js/utils/helpers.js) — export `thLabel(full, abbr)`.
- [js/render/leaguePage.js](../js/render/leaguePage.js) — `cols` עם `abbr`: G/W/L/WR%/PR/Lv/Lk/#/PRW/Pts/APts.
- [js/render/playerPage.js](../js/render/playerPage.js) — Opp/Sc/PR/oPR/Lk/Res/Pts.
- [js/render/dashboardPage.js](../js/render/dashboardPage.js) — Top5, Historical, Predictor, What-If, Round, Remaining.
- [js/render/playerGeneralPage.js](../js/render/playerGeneralPage.js) — reorder Rank→col 4, wrapper חדש, cap 25 + expand button, dual-label ב-4 טבלאות.
- [js/render/landingPage.js](../js/render/landingPage.js) — Date/League/T/Win headers.
- [js/admin/leagueManager.js](../js/admin/leagueManager.js) — inline dual-span ב-admin leagues table.

### סיכון ידוע
- **זום 2.0× על 1440** (= 720px effective) לא מפעיל את ה-breakpoint של 640px ולכן ה-wrapper עובר ל-scroll אופקי פנימי ללא sticky. זה התנהגות desktop-tablet צפויה; המשתמש זקוק לזום 2.3× לפחות כדי להפעיל את ה-mobile mode. אם יש צורך ב-sticky באזור ה-720–960 — נדרשת הרחבת ה-breakpoint או רולינג סטיקי חדש לdesktop overflow.

---

## שלב 6.6b — Admin Mobile Matrix + Cancel-Sidebar Persistence ✅ (2026-04-16)

**תוכנית מקור:** `C:\Users\User\.claude\plans\federated-gliding-cat.md`

### בעיות שנחשפו
1. המשתמש דיווח: ה-mobile compression של 6.6 **לא תקף למסכי Admin** (Leagues tab, Edit League, New League). שורש הבעיה — [admin.html](../admin.html) לא טוען את `components.css` (רק `admin.css`), לכן כל ה-`@media (max-width: 640px)` של 6.6 לא מופעלים באדמין, והטבלה היחידה שכבר יש לה dual-span (league list) מציגה את שני הסיומות יחד כי ה-CSS toggle לא נטען.
2. המשתמש דיווח (mobile + desktop): לחיצה על **Cancel** ב-Edit Mode של ה-Main Dashboard מסירה את ה-sidebar של ADMIN (`unmountAdminSidebar()` ב-[landingPage.js:234](../js/render/landingPage.js)), ולא נשארת דרך חזרה ל-admin.html.

### מה בוצע
- **A. Sidebar נשאר אחרי Cancel** — הוסר הקריאה ל-`unmountAdminSidebar()` מ-`exitEditMode()` ב-[js/render/landingPage.js](../js/render/landingPage.js); נוסף `history.replaceState` להסרת `?edit=1` מה-URL כך שרענון לא מחזיר ל-edit mode.
- **B. בלוק mobile @media עצמאי ב-admin.css** — נוסף בסוף [css/admin.css](../css/admin.css): dual-label swap (`.th-full`/`.th-abbr`) + דחיסת `.admin-table` (font 0.7/0.65rem, padding 3/2px, inputs 0.7rem), `.add-league-grid` ל-1-col, `.form-group` flex:1 1 100%, `.admin-table-compact` עם `min-width:max-content` לגלילה אופקית של CSV editor.
- **C. Dual-label headers ב-admin renderers** — `thLabel()` מיובא מ-[js/utils/helpers.js](../js/utils/helpers.js) ומוחל ב:
  - [js/admin/leagueManager.js](../js/admin/leagueManager.js) — 3 טבלאות (League list 5-col, Add-League players 4-col, Edit-League players 4-col)
  - [js/admin/csvEditor.js](../js/admin/csvEditor.js) — 2 טבלאות (Match editor 10-col עם אבריבציות PA/Lk/Sc/PB/Ed/Act, Overrides 5-col עם T/Match/Why/Date)

### Verification
- **Syntax** — `node --check` על 3 קבצי JS: עבר.
- **Playwright אוטומטי** — נכשל (MCP browser במצב תקוע). המשתמש יבצע verification ידנית ב-375×812 במובייל על admin.html#leagues, Edit-League, Add-League, CSV editor.
- **Cancel flow** — יש לוודא ידנית: `index.html?edit=1` → Cancel → `.admin-sidebar` עדיין קיים, `location.search` לא מכיל `edit=1`.

### קבצים שהשתנו
- [js/render/landingPage.js](../js/render/landingPage.js) — L234: הוסר unmount, נוסף URL cleanup; L20: הוסר import לא-בשימוש
- [css/admin.css](../css/admin.css) — נוספו ~50 שורות mobile block בסוף הקובץ
- [js/admin/leagueManager.js](../js/admin/leagueManager.js) — import `thLabel` + 3 שימושים
- [js/admin/csvEditor.js](../js/admin/csvEditor.js) — import `thLabel` + 2 שימושים

### סיכון ידוע
- **CSV editor** (10 עמודות) נשאר על גלילה אופקית במובייל גם אחרי הדחיסה — זה by-design כי דחיסה אגרסיבית יותר תשבור את ה-inline inputs. שיפור עתידי אפשרי: card-per-match inline editor.
- **Specificity** — `.admin-content .form-group { flex/min-width: ... !important }` עוקף inline styles בתוך `@media max-width:640px` בלבד; דסקטופ לא מושפע.

### תיקון נוסף (6.6b-hotfix, 2026-04-16) — Hamburger drawer חסר ב-Main Dashboard
**בעיה:** לאחר לחיצה על "Main Dashboard" מתוך ה-sidebar של admin.html במובייל, ה-sidebar מוטען ב-`index.html?edit=1` אבל נשאר מחוץ למסך (`transform: translateX(-100%)` דרך ה-CSS של `@media (max-width:767px)`). ה-`adminDrawer.js` (שיוצר את כפתור ה-hamburger + backdrop) הופעל רק מ-`adminPage.js` (admin.html), ולא מ-`adminSidebar.js` — לכן במובייל המשתמש "נלכד" על ה-Main Dashboard ללא דרך לפתוח את ה-drawer.

**תיקון:** הוספה של `initAdminDrawer()` בסוף `mountAdminSidebar()` ב-[js/admin/render/adminSidebar.js](../js/admin/render/adminSidebar.js), ויבוא מ-`../adminDrawer.js`. Playwright אימת: כפתור 44×44px בפינה השמאלית-עליונה, לחיצה פותחת drawer, `transform: matrix(1,0,0,1,0,0)` + `left:0`.

---

## שלב 7 — Editorial Chess design direction

**מטרה:** כיוון עיצובי חדש — typography + theme renames + masthead header.

**היקף:** גדול (יומיים+), כולל טיפוגרפיה חדשה (Fraunces + Inter Tight), שמות themes חדשים, asymmetric headers.

**תנאי:** רק אחרי שהחלטת בפועל שאתה רוצה את הכיוון הזה. יש תוכנית מלאה ב-[whimsical-noodling-graham.md plan] שמוזכרת בסקירה.

**לא מתועד כאן כי:** זה עיצוב מחדש ולא תיקון. עדיף לפתוח תוכנית נפרדת כשתגיע לשלב הזה.

---

## סיכום — סדר ביצוע ומשך משוער

| שלב | מה | משך | סיכון | סטטוס |
|---|---|---|---|---|
| 1 | Quick wins (C2+C5+H4) | 15 דק' | נמוך | ✅ הושלם |
| 2 | Sticky rows (C1) | 30 דק' | בינוני (cross-browser) | ✅ הושלם |
| 3 | a11y batch (H2+H3+H5) | 1 שעה | נמוך | ✅ הושלם |
| 4 | Contrast (C3) | 2 שעות | בינוני (theme-specific) | ✅ הושלם |
| — | **עצירה — audit gates עוברים** | | | ✅ |
| 5 | Admin drawer (C4) | 2 שעות | בינוני (component חדש) | ✅ הושלם |
| 6 | Mobile polish (H6) | 1 שעה | נמוך | ✅ הושלם |
| 6.5 | Mobile layout + zoom (card view ≤640px, disable sticky, scrollbar framing) | 4–6 שעות | בינוני (theme יחיד, טלפון בלבד) | 🔄 הוחלף ע"י 6.6 |
| 6.6 | Mobile Matrix + Compression (replaces 6.5) — matrix layout, font compression, dual-label headers, conditional sticky | 3–4 שעות | בינוני | ✅ הושלם (2026-04-16, ראה [mobile-design-roadmap-2026-04.md](mobile-design-roadmap-2026-04.md)) |
| 6.6b | Admin Mobile Matrix + Cancel-Sidebar Persistence — standalone admin.css mobile block, dual-label ב-admin renderers, sidebar נשאר אחרי Cancel | ~1.5 שעות | נמוך | ✅ הושלם (2026-04-16) |
| 7 | Editorial Chess | יומיים+ | גבוה (עיצוב מחדש) | ⏭️ גרסה עתידית |

**סה"כ עד ה-gate:** כ-4 שעות עבודה.
**סה"כ עד סוף שלב 6:** כ-7 שעות.

---

## כלים ופקודות שימושיות

```bash
# הפעלת שרת
npx http-server -p 3000 --cors -c-1

# בדיקת overflow ב-console הדפדפן
document.documentElement.scrollWidth === window.innerWidth

# בדיקת touch targets
Array.from(document.querySelectorAll('a,button,input,[role="button"]'))
  .filter(el => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
  .length

# הרצת axe-core (אחרי הזרקת CDN)
axe.run().then(r => console.log(r.violations.filter(v => ['critical','serious'].includes(v.impact))))
```
