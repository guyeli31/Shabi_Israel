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

קובץ רינדור: [js/render/landingPage.js](../js/render/landingPage.js)

### B — Dashboard / League overview (dashboard.html)

| קוד | שם הטבלה | סלקטור |
|---|---|---|
| B1 | Prizes & Medals | `.dash-table.prizes-table` |
| B2 | Historical view | `.dash-table` |
| B3 | Championship Predictor | `.dash-table` |
| B4 | What If Simulator | `.dash-table.whatif-table` |
| B5 | Rounds | `.dash-table` |
| B6 | Remaining Matches | `.dash-table` |

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

- `#leagueTable` בדף [league.html](../league.html)
- קובץ רינדור: [js/render/leaguePage.js](../js/render/leaguePage.js)
- **מחוץ לסקופ של איחוד העיצוב**

### E — טבלת שחקן בליגה

- `#playerTable` בדף [player.html](../player.html)
- קובץ רינדור: [js/render/playerPage.js](../js/render/playerPage.js)
- **מחוץ לסקופ של איחוד העיצוב**

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

כלי האפיון חייב לאמת לכל טבלה:

1. **אין טבלה רחבה מהמיכל ללא STICKY** — בסוף הקסקדה, STICKY חייב להיות מופעל.

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

2. **אין דליפה ויזואלית** — תוכן של תאים לא-STICKY לא משתקף מתחת לתאי STICKY בגלילה. בדיקה: לאחר `scrollLeft = 50`, צלם והסתכל שהתוכן לשמאל של התא הסטיקי אטום ולא מראה טקסט גולש.
3. **צבע רקע של תא STICKY** זהה לתאים לא-STICKY באותה שורה (אין "עמודה/שורה מוארת"). בדיקה: `getComputedStyle(td_sticky).backgroundColor === getComputedStyle(td_non_sticky).backgroundColor` עבור אותה שורה.
4. **HOVER** מכסה שורה שלמה כולל STICKY, אחיד בכל הטבלאות.
5. **אייקונים** (TITLE, מדליה) לא מגדילים גובה שורה או רוחב עמודה מעבר לטקסט של התא.
6. **תאים עם עיצוב מיוחד** (TYPE/STATUS/pills/badges) — גודל הטקסט זהה לשאר תאי הטבלה.
7. **אין hard-code למימדים** — שינוי תוכן / פונט / שורות ברירת מחדל מעדכן את המימדים אוטומטית, ללא CSS קבוע.
8. **עודף רוחב** מתחלק פרופורציונלית בין כל העמודות לפי תוכן (לא מוגבל לעמודות שחקנים).
9. **פרמטר 2 (מיקום)** — ערך MOBILE זהה ל-DESKTOP אלא אם הוגדר במפורש אחרת.
10. **תוכן עמודת STICKY לא נחתך** — כאשר עמודה מכילה טקסט דינמי (שם שחקן + badge/title), יש לוודא שאין `max-width` קבוע שחוסם את ה-`max-content`. הבדיקה: לאחר SHOW ALL (מצב עם מקסימום שורות), בדוק שאין תוכן שנחתך או דולף מחוץ לתא. אם הרוחב נקבע ב-JS (כלל ברזל 12), חובה לוודא שה-JS אכן רץ ועדכן את ה-CSS variable לפני שנמדד ה-sticky — ולא נשאר ערך ה-fallback של ה-CSS.
