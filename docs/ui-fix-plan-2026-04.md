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
   - שינוי `<html lang="he" dir="ltr">` ל-`<html lang="en" dir="ltr">` בכל קבצי ה-HTML ([index.html](../index.html), [league.html](../league.html), [player.html](../player.html), [player_general.html](../player_general.html), [dashboard.html](../dashboard.html), [admin.html](../admin.html)).

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
- פתח [league.html](../league.html?league=Shabi%20Israel%20April%202026) בדסקטופ + מובייל (375).
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

## שלב 6 — Mobile polish (H1 + H6 + H7)

**מטרה:** חוויית מובייל מלוטשת.

### משימות
1. **H1 — Touch targets ≥ 44×44px**
   - [components.css](../css/components.css): `td.player-cell a { padding: 12px 0; display: inline-block; min-height: 44px; }`
   - [navigation.css](../css/navigation.css): min-height 44px על nav links, breadcrumbs, dropdown buttons.
   - Sortable headers: `padding: 14px var(--space-md);`.

2. **H6 — Floating buttons safe-area**
   - [theme-picker.css](../css/theme-picker.css): `bottom: calc(16px + env(safe-area-inset-bottom));`
   - אותו דבר ל-admin button אם יש.
   - ב-[index.html](../index.html) (ועוד) `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

3. **H7 — Hide empty Date column**
   - ב-[js/render/playerPage.js](../js/render/playerPage.js): אחרי ה-render, לבדוק אם כל התאים בעמודה = '—'. אם כן — `th.style.display = 'none'` + כל ה-`td`-ים המתאימים.
   - helper generic: `hideEmptyColumns(tableEl, emptyMarker = '—')`.

### בדיקה ידנית
- DevTools mobile → לחץ על player-name link — קל להקליק.
- theme picker לא נחסם ע"י Safari URL bar.
- עמוד player — עמודת Date נעלמה, הטבלה תופסת יותר רוחב.

### Verification gate
- [ ] כל focusable ≥ 44×44px (`Array.from(document.querySelectorAll('a,button,input')).filter(el => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length === 0`)
- [ ] theme picker גלוי מעל iOS Safari URL bar
- [ ] עמודת Date מוסתרת ב-player.html כשכולה ריקה

---

## שלב 7 — Editorial Chess design direction

**מטרה:** כיוון עיצובי חדש — typography + theme renames + masthead header.

**היקף:** גדול (יומיים+), כולל טיפוגרפיה חדשה (Fraunces + Inter Tight), שמות themes חדשים, asymmetric headers.

**תנאי:** רק אחרי שהחלטת בפועל שאתה רוצה את הכיוון הזה. יש תוכנית מלאה ב-[whimsical-noodling-graham.md plan] שמוזכרת בסקירה.

**לא מתועד כאן כי:** זה עיצוב מחדש ולא תיקון. עדיף לפתוח תוכנית נפרדת כשתגיע לשלב הזה.

---

## סיכום — סדר ביצוע ומשך משוער

| שלב | מה | משך | סיכון |
|---|---|---|---|
| 1 | Quick wins (C2+C5+H4) | 15 דק' | נמוך |
| 2 | Sticky rows (C1) | 30 דק' | בינוני (cross-browser) |
| 3 | a11y batch (H2+H3+H5) | 1 שעה | נמוך |
| 4 | Contrast (C3) | 2 שעות | בינוני (theme-specific) |
| — | **עצירה — audit gates עוברים** | | |
| 5 | Admin drawer (C4) | 2 שעות | בינוני (component חדש) |
| 6 | Mobile polish (H1+H6+H7) | 1 שעה | נמוך |
| 7 | Editorial Chess | יומיים+ | גבוה (עיצוב מחדש) |

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
