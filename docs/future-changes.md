# שינויים עתידיים מתוכננים

## 1. Admin Mode — מוד מנהל ליגה

ממשק ניהול גרפי (GUI) בדפדפן המאפשר למנהל הליגה לנהל את כל הנתונים ישירות מהאתר, ללא צורך ב-git ידני.

**גישה טכנית:** GitHub API Integration — שמירה ישירה ל-repo דרך GitHub REST API עם Personal Access Token.

---

### 1.1 מסך כניסה (Login)

- **Username + Password** — מאוחסנים כ-hash ב-JS (הגנה קוסמטית — מרתיעה משתמשים רגילים)
- **GitHub Personal Access Token** — נשמר ב-`localStorage` (ההגנה האמיתית — בלעדיו אי אפשר לכתוב ל-repo)
- Session נשמר ב-`localStorage` עד logout
- מנהל יחיד

### 1.2 ניהול ליגות

- **הוספת ליגה חדשה:** טופס עם שם ליגה + קונפיגורציה (סוג ליגה) → יוצר תיקייה חדשה ב-`leagues/`, מעדכן `landing_settings.json`, יוצר `league_params.json`
- **מחיקת ליגה:** בחירה מרשימה → מוחק תיקייה מ-repo, מעדכן `landing_settings.json`
- **קונפיגורציה:** עריכת `league_params.json` (כותרת, פרסים, custom flags)
  - **פרסים (מדליות):** המנהל מגדיר כמה זוכים בכל דרגה:
    - `GoldCount` — מספר זוכי זהב (מקום ראשון). כיום hardcoded כ-1
    - `SilverCount` — מספר זוכי כסף (מקום שני). כיום hardcoded כ-1
    - `BronzeCount` — מספר זוכי ארד (מקום שלישי). כיום קיים ב-`league_params.json`
  - **שינוי נדרש ב-`leaguePage.js`:** הלוגיקה ב-`getRankClass()` ו-`getMedalHtml()` תשתנה מ-hardcoded rank 1/2 לטווחים דינמיים לפי הספירות
- **שינוי סטטוס ליגה:** toggle בין Running ↔ Completed — מעדכן את `Running` ב-`league_params.json` (`true`/`false`). משפיע על ה-status pill בדף הראשי

### 1.2.2 פרסום שינויים לאתר

השינויים שהמנהל מבצע (הוספת ליגה, עדכון CSV, דריסת תוצאות, שינוי דגל וכו') **לא מתפרסמים מיד**. במקום זאת:

1. **שלב עבודה:** כל השינויים נצברים ב-`localStorage` של הדפדפן. המנהל יכול לראות תצוגה מקדימה של התוצאה.
2. **שלב פרסום:** כפתור **"פרסם לאתר"** — שולח את כל השינויים שהצטברו ל-GitHub בבת אחת דרך ה-API. GitHub Pages מתעדכן תוך כדקה.

**ממשק:**
- Badge עם מספר השינויים הממתינים לפרסום
- לפני פרסום — רשימת שינויים ממתינים עם אפשרות לבטל שינוי בודד
- לאחר פרסום — הודעת אישור + ניקוי ה-localStorage

**יתרונות:**
- המנהל יכול לעבוד, לבדוק, ולתקן לפני שהציבור רואה
- אם נעשתה טעות — אפשר לבטל לפני הפרסום
- פחות commits ל-repo (commit אחד עם כל השינויים במקום commit לכל פעולה)

### 1.2.1 עריכת שחקן — בחירת דגל

בתוך מסך קונפיגורציית ליגה, אפשרות לערוך דגל לכל שחקן:

**שתי אופציות לבחירת דגל:**

| אופציה | תיאור | מה קורה |
|--------|-------|---------|
| קוד דגל קיים | בחירה מרשימה נפתחת של דגלים קיימים ב-`assets/flags/` | מעדכן את `CustomFlags` ב-`league_params.json` |
| העלאת דגל חדש | גרירת קובץ PNG או בחירה מתיקייה במחשב | מעלה את ה-PNG ל-`assets/flags/{CODE}.png` דרך GitHub API + מעדכן `CustomFlags` |

**לוגיקה:**
- המנהל בוחר שחקן מרשימת שחקני הליגה
- מוצגת תצוגה מקדימה של הדגל הנוכחי (ברירת מחדל: IL)
- המנהל מזין קוד דגל (למשל `US`, `FR`) — אם קיים ב-`assets/flags/`, הדגל מוצג מיד
- אם הקוד לא קיים — מוצג שדה העלאה (drag & drop או בחירת קובץ) להעלאת PNG חדש
- ה-PNG נשמר ל-`assets/flags/{CODE}.png` דרך GitHub API
- `league_params.json` מתעדכן: `CustomFlags[playerName] = CODE`

**דרישות לקובץ PNG:**
- פורמט: PNG בלבד
- מומלץ: 48×32 פיקסלים (יחס 3:2, כמו הדגלים הקיימים)

### 1.3 העלאת Excel/CSV

- **Drag & drop** — אזור גרירה לקובץ Excel (.xlsx) או CSV
- עיבוד client-side באמצעות ספריית SheetJS/xlsx (CDN, ללא npm)
- תצוגה מקדימה של הנתונים לפני שמירה
- שמירה כ-`leaguedata.csv` ב-repo דרך GitHub API

### 1.4 עריכת תוצאות ידנית + מנגנון Overrides

- טבלה אינטראקטיבית של כל המשחקים בליגה
- אפשרות לערוך שורה קיימת (דריסה) או להוסיף שורה חדשה

**סוגי הזנה ידנית:**

| סוג | שדות נדרשים | השפעה על סטטיסטיקה |
|-----|-------------|-------------------|
| תוצאה רגילה (דריסה) | כל השדות (Score, PR, Luck) | נספר ב-Games, W/L, WinRate **וגם** משוקלל ב-PR, Luck, ממוצעים |
| ניצחון טכני | שחקן מנצח + שחקן מפסיד | נספר ב-Games, Wins/Losses, WinRate. **לא** משוקלל בממוצעי PR/Luck |
| תיקו טכני | שני השחקנים | נספר ב-Games (לא Win ולא Loss). **לא** משוקלל בממוצעי PR/Luck |

**ניצחון/תיקו טכני — לוגיקה:**
- בכרטיס השחקן (player page): השורה מוצגת עם RESULT (W/L/D) אבל שדות PR, Luck ריקים / לא רלוונטיים
- ב-`stats.js`: ערכי PR/Luck לא נכנסים למערכי הממוצעים (`prValues`, `luckValues` וכו') — רק `games`, `wins`, `losses` מתעדכנים

**מנגנון Overrides:**
- כל דריסה ידנית נשמרת בקובץ `manual_overrides.json` בתיקיית הליגה
- Override תמיד דורס — גם כשעולה CSV חדש, ה-overrides מוחלים עליו אוטומטית
- Match key = `playerA + playerB` (שני הכיוונים)
- Override נשאר פעיל עד שהמנהל מוחק אותו ידנית מממשק הניהול
- בממשק ה-admin: רשימת overrides פעילים עם אפשרות מחיקה

מבנה `manual_overrides.json`:
```json
{
  "overrides": [
    {
      "type": "result",
      "playerA": "Guy",
      "playerB": "Dan",
      "scoreA": 3,
      "scoreB": 1,
      "prA": 5.2,
      "prB": 12.1,
      "luckA": 0.3,
      "luckB": -0.3,
      "reason": "תיקון ידני - תוצאה שגויה באקסל",
      "timestamp": "2026-04-06T12:00:00Z"
    },
    {
      "type": "technical_win",
      "playerA": "Guy",
      "playerB": "Dan",
      "winner": "Guy",
      "reason": "אי-הגעה",
      "timestamp": "2026-04-06T14:00:00Z"
    },
    {
      "type": "technical_draw",
      "playerA": "Guy",
      "playerB": "Dan",
      "reason": "שני השחקנים לא הגיעו",
      "timestamp": "2026-04-06T15:00:00Z"
    }
  ]
}
```

### 1.4.1 סימון שחקן כפורש

המנהל יכול לסמן שחקן כ"פורש" מליגה פעילה.

**התנהגות:**
- **טבלת הליגה (league_table.html):** השחקן ממשיך להופיע עם כל הנתונים שלו (דירוג, WinRate, PR וכו') כאילו לא פרש, אבל עם סימון ויזואלי ייחודי (למשל: אייקון 🚪, שורה מעומעמת, או תגית "Retired")
- **כרטיס השחקן (player_league.html):** סימון פרישה מוצג בכותרת הכרטיס. טבלת המשחקים נשארת ללא שינוי
- **דירוג:** השחקן נשאר בדירוג הרגיל — הפרישה היא סימון תצוגתי בלבד, לא משפיעה על חישובים

**מימוש:**
- שדה `RetiredPlayers` ב-`league_params.json` — מערך שמות שחקנים פורשים
- ב-`leaguePage.js` → `renderDataRows()`: בדיקה אם השחקן ברשימת הפורשים → הוספת class `retired` לשורה + סימון ויזואלי
- ב-`playerPage.js`: הוספת תגית פרישה ליד שם השחקן

```json
{
  "RetiredPlayers": ["PlayerName1", "PlayerName2"]
}
```

### 1.5 דו"ח Remaining Matches

דו"ח לכל ליגה המציג כמה משחקים נותרו לכל שחקן. ניתן לצפייה באתר ולייצוא כתמונה לשליחה ב-WhatsApp.

**תוכן הדו"ח:**
- כותרת הליגה
- רשימת כל השחקנים, מדורגים מהכי הרבה משחקים שנותרו עד הכי פחות
- לכל שחקן: שם + מספר משחקים שנותרו
- סקאלת צבעים אדום→ירוק (אדום = הכי הרבה נותרו, ירוק = הכי פחות). BOLD בקצוות (מקסימום ומינימום)
- חותמת זמן הפקת הדו"ח (תאריך + שעה)

**חישוב:** remaining per player = `(n - 1) - games` כאשר `n` = מספר שחקנים בליגה. הנוסחה קיימת כבר ב-`rankings.js:computeMatchStats()`.

**סקאלת צבעים:** שימוש ב-`colorForValue()` מ-`colorScale.js` (inverted — הרבה נותרו = אדום, מעט = ירוק).

**ייצוא כתמונה:**
- שימוש ב-`html2canvas` (CDN) להמרת ה-DOM לתמונה (canvas → PNG)
- כפתור "הורד כתמונה" — שומר PNG למכשיר, מוכן לשליחה ב-WhatsApp
- כפתור "שתף" — אם הדפדפן תומך ב-Web Share API, פותח ישירות את תפריט השיתוף

**זמינות:**
- למנהל: בממשק ה-admin, כפתור "דו"ח משחקים" ליד כל ליגה
- באתר הציבורי: אפשרות להציג גם בדף הליגה (league_table.html) לכלל הגולשים

---

## ארכיטקטורה טכנית

### קבצים חדשים
```
admin.html                          — דף הניהול הראשי
js/admin/auth.js                    — אימות (login/logout, token management)
js/admin/githubApi.js               — wrapper ל-GitHub REST API (CRUD קבצים)
js/admin/leagueManager.js           — לוגיקת ניהול ליגות
js/admin/csvEditor.js               — עורך CSV אינטראקטיבי
js/admin/excelImporter.js           — ייבוא Excel (SheetJS)
js/admin/render/adminPage.js        — רינדור ממשק הניהול
css/admin.css                       — סגנונות ייחודיים לדף admin
```

### תלויות חיצוניות
- **SheetJS (xlsx)** — לקריאת קבצי Excel. CDN בלבד, ללא npm.
- **html2canvas** — להמרת DOM לתמונת PNG (לדו"ח Remaining Matches). CDN בלבד.

### GitHub API Endpoints בשימוש
- `GET /repos/{owner}/{repo}/contents/{path}` — קריאת קבצים
- `PUT /repos/{owner}/{repo}/contents/{path}` — יצירה/עדכון קובץ (עם SHA)
- `DELETE /repos/{owner}/{repo}/contents/{path}` — מחיקת קובץ

### שינויים בקבצים קיימים
- `js/data/csvParser.js` — הוספת טעינת overrides לאחר parsing ה-CSV
- `js/compute/stats.js` — זיהוי משחקים טכניים (PR/Luck = null) — ספירת Games/W/L/WinRate בלבד, בלי לדחוף ל-`prValues`/`luckValues`
- `js/render/playerPage.js` — הצגת שורת משחק טכני עם RESULT בלבד, שדות PR/Luck ריקים
- `js/render/leaguePage.js` — `getRankClass()` ו-`getMedalHtml()` ישתנו מ-hardcoded rank 1/2 לטווחים דינמיים לפי `GoldCount`/`SilverCount`/`BronzeCount`

---

## אבטחה

| שכבה | מנגנון | רמת הגנה |
|------|--------|----------|
| 1 | Username + Password (hash ב-JS) | קוסמטית — מרתיעה משתמש רגיל |
| 2 | GitHub PAT ב-localStorage | אמיתית — בלי זה אי אפשר לכתוב ל-repo |
| 3 | GitHub repo permissions | מוחלטת — רק collaborators יכולים ליצור token עם write access |

> **הערה:** הסיסמה גלויה בקוד ה-JS לכל מי שפותח DevTools. זו הגנה קוסמטית בלבד. ה-GitHub Token הוא ההגנה האמיתית.

---

## 2. שינויים לגרסה עתידית — תכנית עבודה

תכנית עבודה מדורגת בשלבים לפי סדר כרונולוגי מומלץ למימוש. כל שלב בנוי על קודמו.

---

### Phase A — תיקוני UI מהירים (דפים קיימים)

#### A1. שורות תחתונות קבועות (Sticky bottom rows)
- 2 השורות התחתונות בטבלת הליגה יהיו `position: sticky; bottom: 0` — תמיד נראות גם בגלילה
- כנ"ל עבור **שורת הסיכום בכרטיס השחקן**

#### A2. צבעי שורות עוקבים אחרי השחקן
- כרגע כשממיינים את הטבלה, צבעי הרקע (לשחקנים מובילים) נשארים קבועים במיקום השורה
- תיקון: כל שחקן מקבל צבע לפי **הדירוג הראשוני** (מיון ברירת מחדל), והצבע נצמד אליו בכל מיון

#### A3. איחוד שדות Luck בכרטיס שחקן
- במקום שני שדות נפרדים "Luck" ו-"Opp Luck" → שדה אחד **"Luck"** שערכו `Luck - Opp Luck`

#### A4. חותמת "עודכן לאחרונה"
- הצגת שדה "Last Updated" עם תאריך ושעה, כפי שהיה בגרסת MATLAB המקורית

#### A5. Games Played כיחס
- הצגת Games Played כ-`"3/7"` — משחקים ששוחקו מתוך סה"כ משחקים מתוכננים (כולל שחקנים שטרם שיחקו)

---

### Phase B — הצגת שחקנים שטרם שיחקו

#### B1. שחקנים ללא משחקים בטבלת הליגה
- שחקנים הרשומים ב-CSV אך טרם שיחקו אף משחק יופיעו בטבלת הליגה
- ערכי Win Rate, Mean PR, Level, Luck יוצגו כ-**"N/A"**
- בדירוג: ממוקמים **מעל** שחקנים עם Win Rate = 0% (רק הפסדים)
- מקור הנתונים: ה-CSV כבר מכיל את כל השחקנים כולל משחקים שטרם שוחקו (שורות עם תוצאה ריקה)

#### B2. כל היריבים בכרטיס השחקן
- בכרטיס שחקן בליגה ספציפית, כל יריבי הליגה יופיעו — כולל שחקנים שלא שיחקו אף משחק מול אף אחד

---

### Phase C — מערכת Themes

#### C1. בורר 5 ערכות נושא + כפתור Customize
5 themes בסה"כ (כולל הנוכחי):

| # | שם | תיאור |
|---|-----|-------|
| 1 | **Current** | הערכה הקיימת (ברירת מחדל) |
| 2 | **Dark** | מצב כהה |
| 3 | **Beige/Brown** | גווני בז׳ וחום, טונים חמים |
| 4 | **Modern** | עיצוב נקי, חדשני ועכשווי |
| 5 | **Royal** | צבעי מלוכה: אדום רויאל, כחול רויאל, זהב. טבלת הליגה בצבעי **רולטה** (אדום/שחור לסירוגין) |

**מימוש:** CSS custom properties (כבר קיימים ב-`variables.css`) — כל theme דורס את ה-design tokens. Toggle UI דרך כפתור "Customize".

#### C2. Theme נשמר בין דפים
- שמירה ב-`localStorage` — הערכה הנבחרת תקפה לאורך כל הגלישה באתר, בכל הדפים

---

### Phase D — סוגי ליגות מרובים

כל הליגות חולקות את אותו פורמט CSV אך מתנהגות שונה לפי סוג. סוג הליגה מוגדר ב-`league_params.json`.

#### D1. תשתית סוג ליגה
- שדה חדש ב-`league_params.json` המגדיר את סוג הליגה
- לוגיקת rendering וחישובים מותנית לפי הסוג

#### D2. ליגה רגילה (Regular League)
- מדדי PR ו-Luck **לא רלוונטיים** — מוסתרים מטבלת הליגה ומכרטיסי שחקנים
- ניצחון = שחקן שהגיע ל-5 נקודות (או יותר)
- דירוג על בסיס **כמות ניצחונות בלבד**

#### D3. ליגת UBC
כמו ליגת הכפלות, עם אלמנט נוסף — **PR Wins** (מי שהיה לו PR נמוך יותר בכל משחק):

**שינויים בטבלת הליגה:**
- 2 עמודות חדשות מימין ל-Losses:
  - **PR Wins** — כמה משחקים השחקן ניצח ב-PR
  - **Points** — נקודה אחת עבור ניצחון במשחק + נקודה אחת עבור PR Win (מקסימום 2 למשחק)
- **Win Rate מוחלף ב-Average Points** (סה"כ נקודות / משחקים ששוחקו) — מדד הדירוג הראשי
- **דירוג משני** (תיקו): Mean PR (נמוך יותר = טוב יותר)

**שינויים בכרטיס שחקן:**
- עמודת Result מוחלפת בכמות נקודות שהתקבלו מכל משחק (0, 1, או 2)

**תוצאות טכניות:**
- ניצחון טכני = 2 נקודות
- הפסד טכני = 0 נקודות
- תיקו = מנהל הליגה מחליט כמה נקודות לתת

---

### Phase E — שדרוג ניווט

#### E1. הסרת כפתורי Back
- הסרת כפתורי "Back" הקיימים. חזרה אחורה תהיה דרך הדפדפן (כמו כל אתר)

#### E2. Breadcrumbs
- ניווט היררכי בראש כל דף: `Home > שם ליגה > שם שחקן` — כל חלק לחיץ

#### E3. קישורים חכמים
- כל שם שחקן בכל טבלה הוא לחיץ (ברירת מחדל: כרטיס ליגה)
- כל שם ליגה לחיץ — מנווט ל-Dashboard שלה

#### E4. תפריט הקשר (Context menu)
- קליק ימני על שם שחקן בטבלת ליגה → אופציה לפתוח כרטיס שחקן כללי או כרטיס ליגה ספציפית

#### E5. סרגל ניווט קבוע
- Persistent nav bar בכל הדפים: Home, ליגות פעילות (dropdown), חיפוש שחקן

#### E6. "משחק גם ב..." בכרטיס שחקן
- בכרטיס שחקן בליגה ספציפית — קישורים לליגות אחרות שהשחקן משתתף בהן

#### E7. קיצורי מקלדת
- Esc לחזרה, חצים לניווט מחזורים בטבלת משחקים

---

### Phase F — League Dashboard ✅ IMPLEMENTED

> **Status:** Shipped. Dashboard is now the default landing target when clicking a league on the index page. See [dashboardPage.js](../js/render/dashboardPage.js), [league.html](../league.html), [matchHistory.js](../js/compute/matchHistory.js), [playerBarChart.js](../js/render/playerBarChart.js), [playerNameInteraction.js](../js/render/playerNameInteraction.js).
>
> **Design decisions:**
> - **F2 historical view** uses per-match `updatedAt` stamps stored in `match_history.json` (no CSV snapshots). The history is reconciled on every admin publish: CSV uploads stamp only matches that are new or unchanged; manual edits always restamp with the publish time.
> - **F3 rounds** are inferred from `Player,…` header rows in the CSV (each header opens a new round). Includes unplayed matches with a "Played" column showing the most recent update timestamp.
> - **F1 start date** is written to `league_params.json` (`StartDate`) when a league is created via Admin. Existing leagues fall back to "N/A".
> - **F4 bar chart** is a vanilla Canvas implementation (no Chart.js): fixed-length X axis (n−1 slots), interactive hover with tooltip (opponent / score / PR / luck / date), grid major every 5 + minor every 1, moving average line that stops at the last played match. Multiple charts can be added side by side via "+ Add chart" for comparison.
> - **Cosmetic add-ons:** prev/next league navigation arrows in the header (filtered to the current `LeagueType` only, chronological order), distinct medal row colors in the historical table (gold/silver/bronze), left-aligned Player column for flag stacking, right-click context menu on player names (left click is reserved for the future general player card from Phase G), and a `League Type` summary card.
>
> **Cleanup:** Removed dead `PR` / `UBC` boolean fields from all `league_params.json` files — these were MATLAB-era leftovers replaced by `LeagueType`.

### Phase F — League Dashboard (original spec)

#### F1. דף Dashboard לכל ליגה
דף חדש לכל ליגה עם סטטיסטיקות כלליות:
- כמות משחקים ששוחקו מתוך סה"כ
- PR ממוצע עדכני
- שחקן מוביל
- **תאריך פתיחת הליגה**

#### F2. טבלה היסטורית (נכון ל...)
- Dropdown לבחירת תאריך עדכון — צפייה במצב הטבלה כפי שהיה בכל snapshot שהועלה

#### F3. טבלת משחקים עם ניווט מחזורים
- ניווט ימינה/שמאלה בין מחזורים, או בחירת מחזור ספציפי בלחצן

#### F4. בחירת שחקן + גרף Bar
- בחירת שחקן עם אופציות:
  - **כרטיס שחקן** — כרטיס הליגה הרגיל
  - **גרף Bar** — משחקים בסדר כרונולוגי לפי עדכונים (לא סדר מחזורים):
    - צבע עמודה = ניצחון/הפסד
    - גובה עמודה = PR או Luck (לבחירת המשתמש)
    - קו ממוצע נע ברקע
  - **סטטיסטיקות חוצות-ליגות** — קישור לכרטיס שחקן כללי

---

### Phase G — כרטיס שחקן כללי (Cross-League Profile)

#### G1. דף שחקן חוצה-ליגות
דף ייעודי לכל שחקן המציג את פעילותו בכל הליגות.

#### G2. כותרת
- שם שחקן + **עיגול ירוק** אם פעיל בליגה רצה כרגע
- כל הדגלים שתחתם שיחק, זה לצד זה

#### G3. סטטיסטיקות PR (מפוצל לפי סוג ליגה)
- **Total PR** — ממוצע כללי לכל משחקי אותו סוג
- **Last 300 PR** — משוקלל לפי אורך משחק (משחק עד 7 = שווה 7, משחק עד 5 = שווה 5; סכום 300 "נקודות" אחרונות)
- ליד כל PR: **תווית סולם** מתאימה + בסוגריים **מיקום כללי** מבין כל השחקנים הפעילים באותו סוג ליגה בשנה הקלנדרית (למשל: "1842 (3rd)")

#### G4. היסטוריית ליגות
- טבלה של כל הליגות שהשחקן השתתף בהן, בסדר כרונולוגי

#### G5. היסטוריית משחקים מלאה
- טבלה כרונולוגית של כל המשחקים מכל הליגות
- מציגה את **כל השדות** שיכולים להופיע בכרטיס שחקן של ליגה ספציפית; מה שלא רלוונטי מסומן N/A
- **סינון:** לפי סוג ליגה, לפי שנה
- **מיון:** לפי כל העמודות הרלוונטיות
- **גרף Bar:** היסטוריית PR עם צבע לפי תוצאה וקו ממוצע נע

#### G6. הישגים ומדליות
- כמות ניצחונות בליגות (מקום 1)
- כמות מקומות שני
- כמות מדליות ארד (מקום 3)
- **מיקום ממוצע** בכל ליגה שהשתתף בה

---

### Phase H — שדרוג דף ראשי (Index Dashboard)

#### H1. ליגות פעילות
- רשימת ליגות פעילות עם אופציה להיכנס לכל אחת
- פרטים: שם ליגה, סוג ליגה, שחקן מוביל

#### H2. טבלאות מובילים שנתיות
- טבלת מובילים אחת **לכל שנה קלנדרית לכל סוג ליגה**
- דירוג לפי: כמות ניצחונות כוללת (בליגת UBC: כמות נקודות כוללת)
- עמודות: אחת לכל חודש (ניצחונות/נקודות באותו חודש), Total, Win Rate, Mean PR
- לחיצה על שחקן → כרטיס שחקן כללי

#### H3. חיפוש שחקן
- שדה חיפוש עם ניווט לכרטיס פעילות כללית

#### H4. מידע כללי
- כמות שחקנים כוללת
- לוגו
- טקסטים קיימים מ-index נשמרים
- **חותמת "עודכן לאחרונה"**
