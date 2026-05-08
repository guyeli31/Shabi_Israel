# Table Design

מסמך יחיד לכללי העיצוב ולמיפוי קודי הטבלאות באפליקציה.
כשמבקשים להגדיר או לשנות טבלה: קרא את המסמך, השווה למה שהמשתמש סיפק, ושאל במפורש על כל פרמטר חובה שלא הוגדר.

---

## חלק 1 — Table Mapping

מיפוי קודי טבלאות באפליקציה. כל התייחסות עתידית לטבלה תהיה לפי הקוד שבטבלה.

### A — Index (index.html)

| קוד | שם הטבלה | סלקטור |
|---|---|---|
| A1 | Completed Leagues | `.completed-leagues-table` |
| A2 | Annual Leaderboards | `.leaderboard-table` |
| A3 | Achievements | `.achv-table` |
| A4 | PR Leaders | `.achv-table` |
| A5 | Match Records | `.achv-table.match-records-table` |
| A6 | League Records | `.achv-table.league-records-table` |

קובץ רינדור: [js/render/landingPage.js](../js/render/landingPage.js)

### B — Dashboard / League overview (dashboard.html)

| קוד | שם הטבלה | סלקטור |
|---|---|---|
| B1 | Prizes & Medals | `.dash-table.prizes-table` |
| B2 | Historical view | `.dash-table` |
| B3 | Championship Predictor | `.dash-table` |
| B4 | What If Simulator | `.dash-table.whatif-table` |
| B5 | Rounds | `.dash-table` |
| B6a | All Remaining | `.dash-table` |
| B6b | Remaining Report | `.dash-table player-remaining-table` |
| B6c | Remaining Per Player | `.rem-b6c-table` |

קובץ רינדור: [js/render/dashboardPage.js](../js/render/dashboardPage.js)

### C — Player General (player-general.html)

| קוד | שם הטבלה | סלקטור |
|---|---|---|
| C0 | טבלאות נפתחות בכרטיסי PR STATISTICS ו-ACHIEVEMENTS | `.pg-rank-expanded .pg-rank-table` |
| C1 | Leagues | `.pg-leagues-table` |
| C2 | Match History | `.pg-matches-table` |
| C3 | Matchup (תת־סקשן ב-Match History) | `renderMatchup` |
| C4 | Match Records | `.achv-table.pg-mr-table` |

קובץ רינדור: [js/render/playerGeneralPage.js](../js/render/playerGeneralPage.js)

### D — טבלת ליגה כללית

- סלקטור: `#leagueTable.font-small` בתוך `.table-scroll` ב-`.table-wrapper` בדף [league.html](../league.html)
- קובץ רינדור: [js/render/leaguePage.js](../js/render/leaguePage.js)
- **כותרות עמודה סטטיות מקוצרות:**
  - Doubling: `#`, `Player`, `GP`, `W`, `L`, `Win%`, `PR`, `Level`, `Luck`
  - UBC: `#`, `Player`, `GP`, `W`, `L`, `PRW`, `PTS`, `Avg PTS`, `PR`, `Level`
  - Regular: `#`, `Player`, `GP`, `W`, `L`
- **STICKY דינמי (כלל ברזל 12):** רוחב עמודת `#` נמדד ב-JS (`measureLeagueStickyCols` ב-leaguePage.js) ונכתב ל-`--sticky-col-1-width` על `.table-scroll`. ה-`left:` של עמודת `Player` נגזר מהמשתנה. בעת טעינה ובעת `resize` (window + ResizeObserver על הטבלה).

#### פרמטרים פר-טבלה (14)

| # | פרמטר | ערך עבור D |
|---|---|---|
| 1 | רוחב הטבלה | `width: max-content` (גזירה אוטומטית מתוכן) — `.table-scroll` הוא ה-scroll container עם `overflow: auto` |
| 2 | מיקום בעמוד | מרכז (יורש מ-`.page-container`) — DESKTOP ו-MOBILE זהים |
| 3 | מסגרת | `var(--radius-lg)` + `var(--shadow-md)` מ-`.table-wrapper` (לא מהטבלה) |
| 4 | שורות STICKY | `tr.avg-row` (Averages — sticky bottom 0). ה-summary של "Games Played" הוצא מהטבלה ומוצג כשורה ב-`.page-header` (`.games-played`) מתחת לכותרת. |
| 5 | עמודות STICKY | `#` (השמאלית) + `Player`. הקסקדה מופעלת תמיד. עמודה 2 מקבלת `left: var(--sticky-col-1-width)`. |
| 6 | כותרת STICKY לגג | כן — `thead { position: sticky; top: 0 }` (גלובלי) |
| 7 | סגנון שורת כותרת | A5 (UPPERCASE קומפקטי) |
| 8 | גודל פונט | `.font-small` (C4, 0.85rem) |
| 9 | עמודות BOLD | מינימום ומקסימום של כל עמודה נומרית מודגשים ב-`<b>` (כדי שהעין תתפוס את החריגים) |
| 10 | עמודות עם גוון טוב→רע | `games`/`wins`/`winRate`/`luck`/`prWins`/`avgPoints` (טוב→רע) · `losses`/`meanPR` (הפוך) · `Level` לפי `colorForLevel` |
| 11 | מדליות זהב/כסף/ארד | כן — `tr.rank-gold`/`-silver`/`-bronze` (`GoldCount`/`SilverCount`/`BronzeCount` מ-`league_params.json`) |
| 12 | שורות ברירת מחדל | הצג הכל |
| 13 | סגנון SHOW ALL | לא רלוונטי (פרמטר 12 = הצג הכל) |
| 14 | מסגור חיצוני | A5 (`.table-wrapper`) |

### E — טבלת שחקן בליגה

- `#playerTable` בדף [player.html](../player.html)
- קובץ רינדור: [js/render/playerPage.js](../js/render/playerPage.js)
- **מחוץ לסקופ של איחוד העיצוב**

### F1 — Leagues (ADMIN — League Manager)

- סלקטור: `.admin-table.font-large` בתוך `<div class="table-scroll">` ב-`.admin-card` בדף [admin.html](../admin.html) (תצוגת *Leagues*)
- קובץ רינדור: [js/admin/leagueManager.js](../js/admin/leagueManager.js)

#### פרמטרים פר-טבלה (14)

| # | פרמטר | ערך עבור F1 |
|---|---|---|
| 1 | רוחב הטבלה | `width: 100%` בתוך `.admin-card` |
| 2 | מיקום בעמוד | מרכז (יורש מקלף האדמין) — DESKTOP ו-MOBILE זהים |
| 3 | מסגרת | פינות `var(--radius-md)` + הצללה רכה — מהקלף, לא מהטבלה |
| 4 | שורות STICKY | אין |
| 5 | עמודות STICKY | `NAME` (השמאלית). הקסקדה מופעלת תמיד (הטבלה עשויה לגלוש). |
| 6 | כותרת STICKY לגג | לא |
| 7 | סגנון שורת כותרת | A5 (כותרות UPPERCASE קומפקטיות) |
| 8 | גודל פונט | `.font-large` (0.93rem) |
| 9 | עמודות BOLD | אין |
| 10 | עמודות עם גוון טוב→רע | אין |
| 11 | מדליות זהב/כסף/ארד | לא |
| 12 | שורות ברירת מחדל | הצג הכל |
| 13 | סגנון SHOW ALL | לא רלוונטי |
| 14 | מסגור חיצוני | A5 (קלף `.admin-card`) |

### F2 — טבלת הזנת תוצאות לליגה (ADMIN — Round Editor)

- סלקטור: `.admin-round-table` בדף [admin.html](../admin.html) (תצוגת *Match Results* בליגה ידנית)
- קובץ רינדור: [js/admin/roundEditor.js](../js/admin/roundEditor.js)
- **מבנה ייחודי — 2 שורות פר משחק** (שורה אחת לכל שחקן). העמודות `EDITED` ו-`ACTIONS` נכתבות פעם אחת ומשתרעות על שתי השורות באמצעות `rowspan="2"` (חלות על כלל המשחק, לא פר־שחקן).
- כל משחק עטוף ב-`<tbody class="match-block">` נפרד עם `data-rid` אחיד ומאזיני האירועים מתבססים על `closest('tbody[data-rid]')`.
- **STICKY**: רק העמודה השמאלית (`PLAYERS`, `.match-player-cell`) — `position: sticky; left: 0;` — מימוש דינמי לפי כלל ברזל 12 (אין רוחב קבוע). רקע על `td` בלבד כדי לכבד כלל ברזל 11 (אין דליפה ויזואלית).
- **זרימת שמירה (חשוב)**: כל שינוי שדה *או* לחיצה על כפתור טכני (`TA`/`TB`/`TD`) רק מציבים ערכים מוצעים בתאים ומסמנים את ה-block כ-`match-block-pending`, ומאפשרים את כפתור `Save` (עם `.btn-save-ready`). רק לחיצה על `Save` קוראת ל-`addChange` ומציגה את הודעת ה-staging הירוקה (`admin-msg-success`).

#### פרמטרים פר-טבלה (14)

| # | פרמטר | ערך עבור F2 |
|---|---|---|
| 1 | רוחב הטבלה | `min-width: max-content` בתוך `.round-editor-scroll`, רוחב המיכל = רוחב הקלף (`.admin-card`) |
| 2 | מיקום בעמוד | מרכז (יורש מקלף האדמין) — DESKTOP ו-MOBILE זהים |
| 3 | מסגרת | פינות `var(--radius-md)` + הצללה רכה — מהקלף, לא מהטבלה |
| 4 | שורות STICKY | אין |
| 5 | עמודות STICKY | `PLAYERS` בלבד (השמאלית). הקסקדה מופעלת תמיד (הטבלה עשויה לגלוש במובייל). |
| 6 | כותרת STICKY לגג | לא |
| 7 | סגנון שורת כותרת | A5 (כותרות UPPERCASE קומפקטיות) |
| 8 | גודל פונט | `.admin-table-compact` (גודל פונט אדמין קומפקטי, לא מתאים ל-enum הציבורי) — מחוץ לסקופ הציבורי |
| 9 | עמודות BOLD | אין |
| 10 | עמודות עם גוון טוב→רע | אין (זו טבלת קלט, לא תצוגה) |
| 11 | מדליות זהב/כסף/ארד | לא |
| 12 | שורות ברירת מחדל | הצג הכל (פר סיבוב) |
| 13 | סגנון SHOW ALL | לא רלוונטי |
| 14 | מסגור חיצוני | A5 (קלף `.admin-card` עם כותרת `Round N`) |

#### מצבים ויזואליים פר-משחק (`<tbody>`)

| מחלקה | מתי | רקע |
|---|---|---|
| ברירת מחדל | משחק ששוחק לפי ה-CSV ולא נערך | `var(--color-surface)` |
| `.match-block-unplayed` | משחק שלא שוחק ואין override | רקע מעומעם, `opacity: 0.6` |
| `.match-block-pending` | המשתמש שינה ערכים/לחץ טכני אך עוד לא לחץ Save | גוון אזהרה רך (mix של `accent-light` + `warning`) |
| `.match-block-overridden` | קיים override שמור ב-staging או ב-repo | `var(--color-accent-light)` |

---

## חלק 2 — פרמטרים פר־טבלה (14)

כשנדרש להגדיר טבלה חדשה או לשנות קיימת, חובה לענות על 14 הפרמטרים הבאים.

| # | פרמטר | אפשרויות | ברירת מחדל |
|---|---|---|---|
| 1 | רוחב הטבלה | % / px | — חובה |
| 2 | מיקום בעמוד | שמאל / מרכז / ימין | מרכז — **יכול להיות שונה בין DESKTOP ל-MOBILE** |
| 3 | מסגרת | רדיוס פינות + הצללה (כן/לא) | כמו היום |
| 4 | שורות STICKY | סיכום / ממוצע / אין | אין |
| 5 | עמודות STICKY | רשימה בסדר הצמדה | עמודה שמאלית — רק כשמופעלת הקסקדה |
| 6 | כותרת STICKY לגג | כן / לא | לא |
| 7 | סגנון שורת כותרת | B2 / A5 | — חובה |
| 8 | גודל פונט | `.font-large` (C1, 0.93rem) / `.font-small` (C4, 0.85rem) | — חובה. בחירת משתמש בלבד, אין שינוי אוטומטי |
| 9 | עמודות BOLD | רשימת שמות עמודות | אין |
| 10 | עמודות עם גוון טוב→רע | רשימה + טווח ערכים | אין |
| 11 | מדליות זהב/כסף/ארד | כן (B2) / לא | לא |
| 12 | שורות ברירת מחדל | מספר שורות עד SHOW ALL | הצג הכל |
| 13 | סגנון SHOW ALL | A2 / A5 | רלוונטי רק אם 12 הוגדר |
| 14 | מסגור חיצוני | A2 / A5 | — חובה |

---

## חלק 3 — כללי ברזל (גלובליים, חלים על כל טבלה)

1. **אין hard-code** לרוחבי עמודות או לגובה טבלה — רק רוחב הטבלה מוגדר. השאר נגזר מתוכן + פונט + שורות ברירת מחדל.
2. **רוחב עמודה** נקבע לפי התא הרחב ביותר (כולל כותרת ואייקון TITLE). עודף רוחב במיכל מתחלק פרופורציונלית בין כל העמודות לפי תוכן.
3. **גודל פונט של הטבלה** נבחר ע"י המשתמש בלבד באמצעות אחת משתי מחלקות:
   - `.font-large` → `font-size: 0.93rem` (C1).
   - `.font-small` → `font-size: 0.85rem` (C4).

   המחלקה מוצמדת פר־טבלה. ערכי ה-`font-size` **קבועים בכל רוחב viewport** — אין media query שמשנה אותם. ה-`padding` של תאים יכול להתכווץ במובייל לצורכי צפיפות, אבל `font-size` לעולם לא.

   בסיס `rem` של הפרויקט (על `<html>`) מוגדר כ-**Fluid Typography** עם `clamp()` — הגודל משתנה ברציפות בין מובייל לדסקטופ, ללא "קפיצה" ב-breakpoint. הערכים ב-`em` (ולא ב-`px`) כדי לכבד את ברירת המחדל של הדפדפן (נגישות):

   ```css
   html { font-size: clamp(0.8125em, calc(0.75em + 0.3vw), 0.9375em); }
   ```

   - מינימום: `0.8125em` (≡ 13px אצל משתמש רגיל) — נכנס בערך ב-viewport ≤ ~400px.
   - מקסימום: `0.9375em` (≡ 15px) — נכנס בערך ב-viewport ≥ ~1050px.
   - בין לבין — סקיילינג ליניארי חלק לפי `vw`.

   אין media query שמשנה את `font-size` של `<html>`. הבסיס הוא מקור יחיד לאמת, מוגדר בקובץ `layout.css` בלבד.
4. **אחידות גודל טקסט** — כל תאי הטבלה (כולל כותרת, סיכום, תאים עם עיצוב מיוחד כמו TYPE/STATUS/badges/pills) באותו גודל פונט.
5. **אייקונים ו-badges בתוך תאים** (TITLE/מדליה/דגל/pills) בגודל הטקסט של התא — לא מגדילים שורה או עמודה. סוג הגופן יכול להיות שונה, הגודל זהה.

   **מימוש נכון — כלל משנה:** גודל הפונט של אייקון/badge בתוך תא חייב להיגזר מהתא עצמו ולא להיות קבוע.
    - **טקסט (למשל `.title-abbr`):** `font-size: 0.8em` — 80% מגודל הטקסט של התא (כך ה-badge נשאר יחסי לשם השחקן הצמוד ולא חורג ממנו). כשהטבלה משנה את מחלקת ה-enum (`.font-large` ↔ `.font-small`), ה-badge נע איתה אוטומטית.
    - **אייקון תמונה (למשל דגל):** `height: 1em` — מתרגם את גובה האייקון לגובה שורת טקסט של התא.
    - **אסור:** `font-size: 0.65rem`, `height: 12px` וכו'. כל ערך ב-`rem`/`px` קבוע ב-badge/אייקון של תא מנתק אותו מה-enum של הטבלה ומפר את כלל 4 (אחידות גודל) וכלל 10 (MOBILE יורש DESKTOP).
    - **אין mobile override** על גודל ה-badge/אייקון — אם הוא יורש נכון מהתא, MOBILE מטופל בחינם ע"י `clamp()` של `html` ומחלקת ה-enum של הטבלה.
6. **THEME אורתוגונלי** למבנה הטבלה (משפיע על צבעים בלבד, לא על מידות).
7. **יישור תוכן**: שמאל.
8. **HOVER אחיד** לכל הטבלאות (כמו C1), מכסה שורה מלאה כולל תאי STICKY.
9. **מיון ומצב ריק** — כקיים היום.
10. **MOBILE יורש DESKTOP** — כל הכללים חלים. כללי STICKY אחידים לכל הטבלאות. רק פרמטר 2 (מיקום) יכול להיות שונה בין המכשירים.
11. **STICKY** — בלי השתקפות/דליפה של מידע מתאים לא-STICKY על תאי STICKY בגלילה. צבע תא STICKY זהה לצבע שאר התאים באותה שורה (אין אפקט "עמודה/שורה מוארת").

    **מימוש נכון — כללי משנה (תקלות שקטות נפוצות):**
    - **ה-scroll container היחיד הוא ה-wrapper.** ה-wrapper מקבל `overflow-x: auto` + `min-width: 0`. הטבלה עצמה חייבת להישאר `overflow: visible`. כל `overflow: hidden/auto/scroll` על אב כלשהו בין תא ה-STICKY לבין ה-wrapper הופך אותו ל-scroll container חדש; אם הוא עצמו לא גולל בפועל — ה-STICKY "מת בשקט" ללא שגיאה ב-DevTools.
    - **`border-radius` + clipping** שייכים ל-wrapper, לא לטבלה. זו דרך לעגל פינות מבלי לפגוע ב-STICKY. לעולם אל תשים `overflow: hidden` על הטבלה רק כדי לחתוך פינות.
    - **רקע STICKY חייב להיות אטום.** צבע חצי-שקוף (rgba/alpha) גורם לתוכן לא-STICKY להיראות "דולף" דרך התא הסטיקי בגלילה. השתמש ב-`color-mix(in srgb, surface N%, tint M%)` לצבע שורה, והחל אותו על **כל ה-td** (כולל הסטיקי) — לא על `tr`.
    - **`z-index` של תא הסטיקי חייב לנצח את התאים שגולשים — היזהר ממלכודות specificity.** ה-`z-index` המיועד לתא סטיקי-לרוחב (לרוב 4 ב-thead corner, 2 ב-tbody) לעיתים קרובות נקבע ב-override מאוחר. אם חוק "בסיס" קודם ממנו (זה שמגדיר `position: sticky; left: 0; z-index: 2`) משתמש בסלקטור עם specificity גבוהה יותר — למשל `:not(.x)`, `:is(...)`, או class נוסף בשרשרת — ה-`z-index: 2` יגבר על ה-override של `z-index: 4` בלי שום אזהרה. התוצאה: תאים לא-סטיקיים (z=3) נצבעים *מעל* תא הסטיקי בגלילה. מלכודת קלאסית: `:not()` מוסיף specificity של ה-class שבתוכו. כלל אצבע — שרשרות הסלקטורים של "בסיס סטיקי" ושל "z-index override" של אותו תא חייבות להיות באותה specificity, כך שמיקום בקובץ יקבע את הזוכה. בדיקת runtime ב-Stage D Rule 11(ב) תופסת זאת.
12. **מימוש STICKY דינמי** — אסור לקבוע רוחב קבוע לעמודת STICKY כדי "לפתור" את ההצמדה.
    - עמודת STICKY יחידה: `position: sticky; left: 0;` — פועל ישירות עם רוחב דינמי (`max-content`), ללא תלות במדידה.
    - מספר עמודות STICKY צמודות: חובה למדוד ב-JS את רוחב כל עמודת STICKY קודמת בעת טעינה ובעת `resize`, ולכתוב את הערכים ל-CSS variables (למשל `--sticky-col-1-width`, `--sticky-col-2-width`) שמהם נגזר ה-`left:` של העמודות הבאות. לעולם לא ערך `px` קבוע ב-CSS.

---

## חלק 4 — קסקדת התכווצות (DESKTOP ו-MOBILE, זהה)

זרימת ההחלטה כשהטבלה רחבה מהמיכל:

1. טבלה נכנסת למיכל → כותרות מלאות, סיום.
2. לא נכנסת → קיצורי כותרת אוטומטיים, אינפורמטיביים, עד תוספת ~20% לרוחב העמודה.
3. עדיין לא נכנסת → קיצור לתו בודד.
4. עדיין לא נכנסת → הפעלת STICKY (לפי פרמטר 5, או ברירת מחדל: עמודה שמאלית).

**אין שלב שינוי פונט** — הפונט נקבע ע"י המשתמש בלבד (`.font-large` או `.font-small`).

---

## חלק 5 — שלבי וריפיקציה (זהים ל-DESKTOP ו-MOBILE)

כלי האפיון חייב לאמת לכל טבלה לפי הסדר הבא: **קודם בדיקות סטטיות (CSS + DOM), אחר כך בדיקות runtime בדפדפן.**

---

### שלב א׳ — בדיקות CSS סטטיות (לפני פתיחת הדפדפן)

1. **אין שינויי CSS hard-coded ב-`@media` לטבלה** — עבור כל סלקטור `@media` שחל על הטבלה, ה-wrapper, ה-`th`, ה-`td` — בדוק שאין:
    - `font-size` — כלל ברזל 3 (גודל פונט קבוע בכל viewport)
    - `white-space` — כלל ברזל 10 (mobile יורש desktop)
    - `padding` — גורם לקפיצה חדה בגובה שורה בנקודת ה-breakpoint
    - `min-width` / `width` / `max-width` בערך `px`/`rem` — כלל ברזל 1
    - `width` בערך `%` על wrapper/מיכל — כאשר רוחב המיכל מוגדר כ-% קבוע בבסיס, **כל** override ב-`@media` (כולל `width: 100%`) גורם לקפיצה חדה בנקודת ה-breakpoint. אם נדרש רוחב יחסי קבוע, הוא חייב להופיע בבסיס בלבד ללא override.

    היחיד המותר בתוך `@media` לתאי טבלה: `display` (הצגה/הסתרה של אלמנטים).

    בנוסף — ללא קשר ל-`@media` — סרוק כל סלקטור שחל על `th`, `td`, או אלמנט פנימי בתא (bar, badge, pill) ובדוק שאין `text-align` שאינו `left` (כלל ברזל 7). חריג מותר יחיד: `text-align: center` על שורת הפרדה עיצובית (למשל `player-remaining-divider`).

2. **אין `width`/`min-width`/`max-width` קבוע על עמודות STICKY** (כלל ברזל 12) — רוחב עמודת STICKY נקבע ע"י הדפדפן לפי `max-content`; אסור לכפות עליה ממד קבוע ב-CSS. בדיקה: סרוק את קוד ה-CSS לכל סלקטור שמיקומו `sticky` — אם קיים `width`, `min-width`, או `max-width` בערך `px`/`rem` קבוע, זו הפרה. חריג מותר יחיד: CSS fallback לטעינה ראשונה בלבד, שמוחלף מיד ב-JS (כדוגמת `--mr-col1-w: 36px`). ה-fallback לא יכול להיות `max-width` שחוסם גדילה.

3. **אין hard-code למימדים** — שינוי תוכן / פונט / שורות ברירת מחדל מעדכן את המימדים אוטומטית, ללא CSS קבוע.

---

### שלב ב׳ — בדיקות DOM סטטיות (דפדפן פתוח, ללא אינטראקציה)

4. **אין `overflow: hidden/auto/scroll` על אלמנט הטבלה עצמו** — הטבלה חייבת להיות `overflow: visible`. בדיקה:
    ```js
    getComputedStyle(document.querySelector('<table-selector>')).overflow
    // חייב להיות "visible"
    ```
    כל `overflow` שאינו `visible` על הטבלה עצמה הופך אותה ל-scroll container חדש ו"הורג" את ה-STICKY בשקט (כלל ברזל 11). ה-`overflow-x: auto` שייך ל-wrapper בלבד.

5. **אין כותרות עמודה שמשתנות כפונקציה של רוחב המסך** — כל `<th>` חייב להכיל טקסט סטטי יחיד, זהה בכל viewport. בדיקה:
    ```js
    const dual = document.querySelectorAll('thead .th-full, thead .th-abbr');
    // dual.length חייב להיות 0
    ```
    אם נעשה שימוש ב-`thLabel()` בבניית ה-thead של הטבלה — זו הפרה. כותרות מקוצרות קבועות (כגון `GP`, `Win%`, `Ch%`) מותרות ומועדפות על פני מנגנון dual-span.

6. **תאים עם עיצוב מיוחד** (TYPE/STATUS/pills/badges) — גודל הטקסט זהה לשאר תאי הטבלה.

7. **אייקונים** (TITLE, מדליה) לא מגדילים גובה שורה או רוחב עמודה מעבר לטקסט של התא.

---

### שלב ג׳ — בדיקות פריסה ויזואלית

8. **עודף רוחב** מתחלק פרופורציונלית בין כל העמודות לפי תוכן (לא מוגבל לעמודות שחקנים).

9. **פרמטר 2 (מיקום)** — ערך MOBILE זהה ל-DESKTOP אלא אם הוגדר במפורש אחרת.

---

### שלב ד׳ — בדיקות STICKY ב-runtime (דורשות גלילה)

10. **אין טבלה רחבה מהמיכל ללא STICKY** — בסוף הקסקדה, STICKY חייב להיות מופעל.

    **איך לבדוק בפועל (Playwright — לא רק קריאת CSS):** אודיט סטטי של `position: sticky` לא מספיק — סטיקי יכול להיות שבור ב-runtime (ראה כלל ברזל 11, תקלות שקטות). הבדיקה חייבת לגלול את ה-wrapper ולמדוד את מיקום התא בפועל:
    ```js
    const w  = document.querySelector('<wrapper-selector>');
    const td = document.querySelector('<table-selector> tbody td:first-child');
    const wrect0 = w.getBoundingClientRect();
    w.scrollLeft = 50;            // גלילה אופקית אמיתית
    const rect = td.getBoundingClientRect();
    const stickyHolds = Math.abs(rect.left - wrect0.left) < 1;
    // stickyHolds === true → עובד. false → STICKY שבור.
    ```
    יש להריץ גם ב-DESKTOP (רוחב ברירת מחדל) וגם ב-MOBILE (≤390px), לאחר ההפעלה לוודא שהטבלה אכן גולשת (`table.scrollWidth > wrapper.clientWidth`), אחרת אין מה לבדוק.

11. **אין דליפה ויזואלית — שני מקרים נפרדים שניהם חייבים להיבדק:**

    **(א) דליפה דרך התא הסטיקי (transparency leak)** — תוכן של תאים לא-STICKY לא משתקף מתחת לתאי STICKY בגלילה. נגרם מ: רקע סטיקי לא אטום (`rgba` עם alpha < 1, `transparent`, או רקע חסר). מכוסה ע"י כלל 12 (כל תא חייב רקע אטום) ובדיקת ה-`backgroundColor` בה.

    **(ב) צביעה מעל לתא הסטיקי (z-stack paint)** — תאים לא-STICKY לא נצבעים *על-גבי* התא הסטיקי בגלילה. נגרם מ-`z-index` נמוך מדי על תא הסטיקי לעומת התאים שגולשים. תקלה שקטה נפוצה: סלקטור עם `:not(.x)`, `:is(.x, .y)`, או class נוסף בשרשרת מעלה specificity של חוק "בסיס" ושובר את ה-`z-index: 4` שמוגדר ב-override מאוחר יותר עם specificity נמוכה יותר. אודיט סטטי של ערכי `z-index` ב-CSS לא יתפוס זאת — חובה בדיקת runtime.

    **בדיקה ל-(ב) — `elementFromPoint` במרכז התא הסטיקי לאחר גלילה אופקית:**

    ```js
    const wrapper = document.querySelector('<wrapper-selector>');
    const table   = document.querySelector('<table-selector>');
    wrapper.scrollLeft = 80;  // מספיק כדי שתאים לא-סטיקיים יחפו על האזור של תא הסטיקי

    // עוברים על thead+tbody. ב-thead כל התאים סטיקי-top — אבל רק תאי הפינה הם גם סטיקי-left,
    // ולכן הם המועמדים שייצבעו עליהם.
    const rows = [...table.querySelectorAll('thead tr'), ...table.querySelectorAll('tbody tr')];
    for (const row of rows) {
      const cells = [...row.querySelectorAll('th,td')];
      // תא סטיקי-לרוחב: position:sticky עם left מוגדר (לא auto)
      const sticky = cells.find(c => {
        const cs = getComputedStyle(c);
        return cs.position === 'sticky' && cs.left !== 'auto';
      });
      if (!sticky) continue;
      const r = sticky.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top  + r.height / 2;
      const topEl = document.elementFromPoint(x, y);
      const ok = topEl === sticky || sticky.contains(topEl);
      // ok === true → התא הסטיקי על-גבי בערימת ה-paint. false → תא לא-סטיקי גולש מעליו (z-stack שבור).
    }
    ```

    אם הבדיקה נכשלת: בדוק את ה-`z-index` המחושב על תא הסטיקי לעומת התאים השכנים (`getComputedStyle(cell).zIndex`). אם הסטיקי קטן מהשכנים — חפש סלקטור עם specificity גבוהה שקובע ערך נמוך וגובר על ה-override המיועד. הפתרון לרוב **השוואת specificity** ולא הוספת `!important`.

12. **צבע רקע של תא STICKY** זהה לתאים לא-STICKY באותה שורה (אין "עמודה/שורה מוארת").

    **חל על כל שורה — כולל שורת הכותרות.** תאי `thead > th` לרוב מקבלים רקע משלהם (למשל `var(--color-bg)`), בעוד שתא ה-STICKY מקבל רקע נפרד (למשל `var(--color-surface)`). אם הבדיקה מצמצמת ל-`tbody td` בלבד — אי-ההתאמה בשורת הכותרות עוברת בלי שתיתפס. הבדיקה חייבת לעבור על שורות `thead` *ו*-`tbody`:

    ```js
    const rows = [...table.querySelectorAll('thead tr'), ...table.querySelectorAll('tbody tr')];
    for (const row of rows) {
      const cells = [...row.querySelectorAll('th,td')];
      const sticky    = cells.find(c => getComputedStyle(c).position === 'sticky');
      const nonSticky = cells.find(c => getComputedStyle(c).position !== 'sticky');
      if (!sticky || !nonSticky) continue;
      // חייב: getComputedStyle(sticky).backgroundColor === getComputedStyle(nonSticky).backgroundColor
    }
    ```

13. **תוכן עמודת STICKY לא נחתך** — כאשר עמודה מכילה טקסט דינמי (שם שחקן + badge/title), יש לוודא שאין `max-width` קבוע שחוסם את ה-`max-content`. הבדיקה: לאחר SHOW ALL (מצב עם מקסימום שורות), בדוק שאין תוכן שנחתך או דולף מחוץ לתא. אם הרוחב נקבע ב-JS (כלל ברזל 12), חובה לוודא שה-JS אכן רץ ועדכן את ה-CSS variable לפני שנמדד ה-sticky — ולא נשאר ערך ה-fallback של ה-CSS.

---

### שלב ה׳ — בדיקות אינטראקציה

14. **HOVER** מכסה שורה שלמה כולל STICKY, אחיד בכל הטבלאות.
