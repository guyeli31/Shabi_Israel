# ארכיטקטורת דף ה‑Analytics — מדריך עקרונות והעברה לפרויקט אחר

> **למי נכתב:** מפתח/ת שרוצה להבין את מערכת ה‑Analytics של Shabi Israel ולשתול אותה
> בפרויקט אתר‑חי אחר, עם סוג DATA שונה לגמרי (לא ליגות/שחקנים). המסמך מתאר את
> העקרון, את מה שהמערכת דורשת משלושת רבדיה (DB, האתר החי, ה‑Dashboard), את חלוקת
> סוגי המשתמשים, ואת שלבי ההעברה.

---

## 0. עקרון‑העל בשורה אחת

מערכת אנליטיקס **first‑party** (אין צד שלישי, אין Google Analytics, אין IP) שבה
כל האתר "יורה" אירועים טבלאיים (pageview / click / duration) לטבלה אחת ב‑Supabase
דרך `fetch`, ו‑Dashboard פנימי מוגן‑התחברות קורא אותם חזרה דרך פונקציות
`SECURITY DEFINER` ומצייר KPIs, גרפים ולוגים. שלוש תכונות מגדירות אותה:

1. **אפס מידע מזהה.** לא נקרא, לא נשלח ולא נשמר IP. ניתוב אזורי נגזר אך ורק
   מאזור‑הזמן של הדפדפן (`Intl…timeZone`). רק שדות **קטגוריים/מדורגים** נאספים.
2. **זהות דו‑מסלולית (two‑route identity).** מבקר ישראלי מקבל `session_id` זמני
   לכל ביקור (sessionStorage, נמחק בסגירת הטאב) כדי שנוכל לשחזר רצף קליקים בתוך
   הביקור; כל שאר העולם — אפס‑קורלציה, בלי מזהה, עם תג יבשת גס בלבד.
3. **insert‑only ל‑anon.** הדפדפן יכול רק `INSERT`. אין ל‑anon `SELECT`. קריאת
   ה‑Dashboard עוברת דרך RPCs שמחזירות JSON מצומצם ומוגנות ל‑`authenticated` בלבד.

```
┌─────────────┐   fetch keepalive INSERT    ┌──────────────────────┐
│  האתר החי   │ ──────────────────────────▶ │ analytics_events     │
│ (analytics  │   (anon, with check(true))  │ (טבלה אחת, RLS)      │
│   .js)      │                             └──────────┬───────────┘
└─────────────┘                                        │ SECURITY DEFINER RPC
                                                        │ (authenticated בלבד)
┌─────────────────────┐   analytics_summary / _raw     │
│ analytics.html      │ ◀──────────────────────────────┘
│ + analyticsPage.js  │   JSON מצומצם, בלי שורות גולמיות
│ + analyticsAggregate│
└─────────────────────┘
```

---

## 1. שלושת הקבצים המרכזיים

| רובד | קובץ | תפקיד |
|------|------|-------|
| איסוף (באתר החי) | [`shabi-israel/js/analytics.js`](../shabi-israel/js/analytics.js) | ה‑beacon. נטען בכל עמוד שיתופי, יורה pageview/click/duration. |
| אחסון + צבירה | [`sql/analytics_poc.sql`](../sql/analytics_poc.sql) | הטבלה, ה‑RLS, וכל ה‑RPCs (summary / raw / months / clicks_search / ordinals). |
| תצוגה (Dashboard) | [`shabi-israel/analytics.html`](../shabi-israel/analytics.html) + [`js/render/analyticsPage.js`](../shabi-israel/js/render/analyticsPage.js) + [`js/data/analyticsAggregate.js`](../shabi-israel/js/data/analyticsAggregate.js) | הדף, הטאבים, והצבירה בצד‑לקוח. |

---

## 2. רובד ה‑DATABASE — מה המערכת מצריכה

### 2.1 טבלה אחת, `public.analytics_events`

העמודות המהותיות (ראו המקור המלא ב‑[`sql/analytics_poc.sql`](../sql/analytics_poc.sql)):

```
id            bigint identity PK
created_at    timestamptz default now()      -- נשמר UTC; מוצג תמיד ב‑Asia/Jerusalem
event_type    text   -- 'pageview' | 'duration' | 'click'   (CHECK סגור)
path, page    text   -- page הוא קבוצה סגורה (CHECK): hub/landing/league/.../admin
league_id, player, tab   text               -- "על מה" קרה האירוע (מזהי תוכן ציבוריים)
referrer_kind text   -- direct/search/social/internal/other (CHECK)
device_type   text   -- mobile/tablet/desktop (CHECK)   + os, browser
duration_ms   int    -- לאירועי duration בלבד
click_target  text   -- לאירועי click בלבד — זו ה"דקדוק" של הקליק (ר' §4)
from_page/from_league_id/from_player  -- מעבר עמוד‑לעמוד (נגזר מ‑document.referrer)
session_id    text   -- מסלול ישראל בלבד (אחרת null)
region        text   -- מסלול גלובלי בלבד, יבשת גסה (אחרת null)   (CHECK)
admin_user    text   -- שם‑המשתמש של המפעיל המחובר; null לכל מבקר רגיל
nav_type      text   -- back/forward/reload על קליקי ניווט דפדפן (CHECK)
```

עקרונות מבניים שחייבים לעבור יחד עם הטבלה:

- **מיגרציה, לא reset.** הקובץ רץ שוב ושוב: `create table if not exists`, ואז
  `add column if not exists` / `drop constraint if exists … add constraint`.
  הרצה חוזרת **אסור** שתמחק שורות קיימות.
- **CHECK סגור רק לקבוצות קבועות** (event_type, page, device_type, region,
  nav_type). שדות פתוחים שגדלים עם ה‑UI (`tab`, `click_target`) נשארים בלי CHECK —
  ערך לא מוכר "מתדרדר" בחן ב‑UI במקום לדחות את כל האירוע ב‑400.
- **אינדקסים:** `created_at`, `page`, `event_type`, ו‑partial index על `session_id`
  (רק מסלול ישראל — כדי שיישאר קטן).

### 2.2 RLS — anon רק מכניס

```sql
alter table public.analytics_events enable row level security;
create policy analytics_anon_insert on public.analytics_events
  for insert to anon with check (true);
grant insert on public.analytics_events to anon;
-- אין SELECT/UPDATE/DELETE ל‑anon בכלל.
```

`with check(true)` אומר שהדפדפן יכול לשלוח כל ערך — `session_id`, `region`,
`admin_user` כולם **client‑asserted**. זו נוחות תצוגה/סינון, **לא** גבול אבטחה.
הדבר היחיד שאוכפים הוא גודל (למשל `length(admin_user) <= 254`) כדי שלא יידחף blob.

### 2.3 קריאה — רק דרך `SECURITY DEFINER` שמחזיר JSON

| RPC | מחזיר | הרשאה |
|-----|-------|-------|
| `analytics_summary(from,to,exclude_admin,scope,hide_admin_pages,exclude_user)` | אובייקט JSON ובו כל ה‑KPIs, ה‑top_pages/leagues/players, timeseries, heatmaps, flows, logs, sessions | `authenticated` |
| `analytics_events_raw(from,to,scope,limit)` | שורות גולמיות (רק העמודות הנחוצות) לצבירה בצד‑לקוח | `authenticated` |
| `analytics_months()` | רשימת החודשים הקיימים (מזין את בורר‑החודשים) | `authenticated` |
| `analytics_clicks_search(from,to,q,…)` | חיפוש קליקים על כל ההיסטוריה (ה‑log מוגבל ל‑500 אחרונים) | `authenticated` |
| `analytics_session_ordinals()` | מפה `{session_id → מספר סידורי}` גלובלי (0 = הסשן הראשון אי‑פעם, ריק‑מוביל ל‑6 ספרות ב‑UI) | `authenticated` |

כל RPC היא `security definer set search_path = public`, ועושים לה
`revoke … from public, anon` ואז `grant execute … to authenticated`. כך tracking
עובד לכל מבקר (INSERT דרך anon), אך **קריאת ה‑Dashboard מחייבת התחברות**.

> שימו לב ל‑`drop function if exists …(חתימה מלאה)` לפני כל `create or replace`:
> `create or replace` לא יכול לשנות רשימת ארגומנטים, אז בלי ה‑drop היו נשארות שתי
> העמסות ו‑PostgREST היה עלול לפתור לישנה ולהתעלם משקט מפרמטר חדש.

---

## 3. רובד ה‑BEACON — `analytics.js` באתר החי

נטען פעם אחת בכל עמוד שיתופי (הוא גם הקובץ היחיד שכל עמוד כבר טוען, ולכן תלו עליו
גם באנרים זמניים). מה שהוא עושה אוטומטית, **בלי שום שינוי בעמוד**:

- **pageview** בטעינה, עם `baseFields()` (page, league_id, player, tab, device,
  referrer).
- **duration** ב‑`pagehide`/`visibilitychange` — זמן נראוּת מצטבר (לא wall‑clock).
- **ניווט דפדפן** (Back/Forward/Refresh) כ‑click עם `nav_type`, באמצעות אינדקס
  מונוטוני ב‑`history.state` + `sessionStorage` (בלי מזהה חדש).
- **קליקים (delegated, capture phase).** מאזין יחיד על `document` שקורא את
  `click_target` מהאלמנט שנלחץ.

### ניתוב הזהות (`send()`)

```js
const routed = (IS_LOCAL || admin != null)
    ? { ...event, session_id: ensureSessionId() }  // ישראל או מפעיל מחובר
    : { ...event, region: coarseRegion(TIMEZONE) }; // כל השאר — אפס קורלציה
const enriched = { ...routed, admin_user: admin };  // המפעיל, לא הקהל
```

### Opt‑out לאוטומציה (חובה!)

הרצת דפדפן אמיתי מול האתר החי יורה beacons אמיתיים. לכן:
`localStorage['shabi:no-analytics']='1'` (ל‑Playwright, דרך `addInitScript`) או
`?notrack` ב‑URL הראשון — וה‑beacon משתתק. `?track` מנקה. `analytics.html` עצמו לא
טוען את `analytics.js`, כך שקריאת ה‑Dashboard לעולם לא "מזהמת".

---

## 4. מה זה מצריך מהלחצנים באתר החי — שלוש תבניות Tracking

הלב של ההעברה. כדי שלחיצה תתועד **בשם נכון ומדויק**, האלמנט צריך להתאים לאחת
משלוש התבניות. ה‑grammar של `click_target` הוא `<Section>: <action>[ — <subject>]`.

### תבנית A — generic selector (אפס עבודה per‑call‑site)

המאזין ב‑`analytics.js` כבר תופס קטגוריות שלמות לפי selector יציב. דוגמאות:

| Selector | `click_target` שנרשם |
|----------|----------------------|
| `[role="tab"]` | `Tab: <dataset.tab>` |
| `.img-export-btn` | `Export: image` |
| `aside a, aside button` | `Menu: <label>` (+ `(Admin Mode)` אם סרגל‑אדמין) |
| `a.nav-arrow` | `Nav: previous/next` |
| `.predictor-tooltip` | `Info: <section heading>` |
| `a[href]` עם `?player=`/`?league=` | `Player link: <x>` / `League link: <x>` |

**העיקרון:** אם רוצים שקבוצת לחצנים תתועד — תנו להם class/attribute יציב משותף,
והוסיפו ענף אחד ל‑listener. זה הדפוס המועדף: שינוי אחד מכסה את כל אתרי‑הקריאה.

### תבנית B — `data-track` סטטי (ערך ידוע בזמן render)

אם הערך המלא ידוע כבר בעת הציור, פשוט שמים אותו על האלמנט:

```html
<button data-track="What if: add match — A vs B">הרץ</button>
```

המאזין קורא `data-track` ישירות. **זהירות — capture phase:** המאזין רץ *לפני*
ה‑handler של הכפתור, אז התבנית הזו מתאימה רק כשהערך קבוע ב‑render ולא מחושב בלחיצה.

### תבנית C — `shabi:interaction` CustomEvent (ערך שמחושב בזמן הלחיצה)

כשה‑label העשיר ידוע רק *בתוך* ה‑handler (למשל Save של טופס: אילו שדות השתנו,
old→new), הכפתור מפזר אירוע משלו, ומסמנים אותו `data-selftrack` כדי שהענף הגנרי
יעמוד בצד:

```js
el.dispatchEvent(new CustomEvent('shabi:interaction',
    { detail: { target: 'Edit league: save settings — July 2026 [entry-fee: 205→210]' } }));
```

```js
// ב‑analytics.js, הענף הגנרי מתעלם מכפתורים מסומנים:
e.target.closest('.btn-success:not([data-selftrack]), .btn-primary:not([data-selftrack])')
```

> **מדיניות שדות ידניים (Admin):** שדה מדווח **רק ב‑Save** כסיכום old→new אחד; סוד
> לעולם אינו שדה (login מתעד רק `success`/`failed`, לעולם לא סיסמה).

**סיכום הכלל להעברה:** לכל אינטראקציה שרוצים לתעד — או selector גנרי (A), או
`data-track` סטטי (B), או `shabi:interaction` + `data-selftrack` (C). שום דבר אחר
לא יירשם מעבר ל‑pageview/duration.

---

## 5. רובד ה‑DASHBOARD — פריסת הדף והטאבים

### 5.1 הדף (`analytics.html`)

- `<meta name="robots" content="noindex,nofollow">` — הדף לא אמור להתאנדקס.
- מסך טעינה (splash) סטטי ב‑first‑paint; שני RPCs (summary + months) נמשכים מעליו.
- אין כותרת/תוכן קשיחים — `renderAnalyticsPage()` כותב הכול לתוך `#content`.
- שער התחברות: אם לא מחובר → `renderLoginGate()`; רק authenticated מריץ את ה‑RPCs.

### 5.2 בורר חודשים + מתגי‑קהל

מעל הטאבים: בורר חודש (`analytics_months`), ומתגי "Exclude any user" / "Exclude
mine" (ר' §6). שינוי מתג מריץ `renderAnalyticsPage()` מחדש — אבל בלי round‑trip:
הצבירה חוזרת בצד‑לקוח (`analyticsAggregate.js`) מאותן שורות גולמיות.

### 5.3 ששת הטאבים (`mountAppTabs`)

| טאב | אייקון | מה מציג |
|-----|--------|---------|
| **Overview** | 📈 | כרטיסי KPI (Pageviews, Sessions‑Israel, Avg dwell, Bounce, Last Updated), timeseries, traffic‑mix. |
| **Audience** | 🌍 | התפלגות device, region (יבשות), referrer. |
| **Content** | 📄 | top pages / leagues / players — עם toggle Pageviews↔Sessions. |
| **Journeys** | 👣 | flows (A→B מצטבר) + transitions_log (כרונולוגי, כולל Back/Forward/Refresh). |
| **Activity** | 🖱️ | clicks_log (כל קליק/אינטראקציה) + sessions (timeline לכל ביקור ישראלי). |
| **History** | 🗄️ | תקצירי טווח ארוכים + חיפוש קליקים על כל ההיסטוריה (`analytics_clicks_search`). |

כל breakdown נושא גם `views` וגם `sessions` כדי שהטאב יוכל לעבור Pageviews↔Sessions.
העשרה ויזואלית (דגלים, badges, pills) נעשית ב‑`analyticsPage.js` דרך
`clickTargetHtml()` — זה **ספציפי לדומיין** של Shabi Israel, וזה בדיוק מה שמחליפים
בהעברה (ר' §7).

---

## 6. חלוקה לסוגי משתמשים

חשוב להפריד בין **מי נמדד** (הקהל) לבין **מי קורא** (ה‑Dashboard):

### מי נמדד (שלוש אוכלוסיות, נקבע per‑row)

| אוכלוסייה | מזהה | מה נשמר | העיקרון |
|-----------|------|---------|---------|
| **מבקר ישראלי** | `session_id` (זמני, sessionStorage) | רצף קליקים בתוך ביקור | ניתן לשחזר ביקור יחיד, אבל אין קישור בין ביקורים (נמחק בסגירת טאב). |
| **מבקר גלובלי** | — (אפס קורלציה) | `region` (יבשת גסה) בלבד | שורות עצמאיות, שום דבר לא נכתב למכשיר — כמו access‑log אנונימי. |
| **מפעיל (Admin)** | `admin_user` (local‑part של המייל) | על שני המסלולים | מסמן את *עצמו*, לא את הקהל; מאפשר ל‑Dashboard להפריד גלישה של המפעיל מתנועת‑קהל אמיתית. |

שני מתגי סינון ב‑Dashboard פועלים על `admin_user`: `exclude_admin` ("הסתר כל
מפעיל") ו‑`exclude_user` ("הסתר רק אותי"). לשורות legacy ישנות שאין בהן `admin_user`
יש אומדן‑תחתון בלבד (`page='admin'` או `(Admin Mode)` ב‑click_target) — לעולם לא
להציג אותו כ"סך‑הכול".

### מי קורא (רובד ההרשאה)

- **anon** — יכול רק `INSERT`. לא רואה כלום.
- **authenticated (Admin)** — היחיד שיכול להריץ את ה‑RPCs ולראות את ה‑Dashboard.
  ההרשאה נאכפת ברמת ה‑`grant execute … to authenticated`, לא בקוד הלקוח.

---

## 7. העברה לפרויקט אתר‑חי אחר עם DATA שונה לגמרי

העיקרון הגדול: **הליבה (איסוף, אחסון, זהות דו‑מסלולית, הרשאות, רוב ה‑Dashboard)
אגנוסטית לדומיין.** מה שתלוי‑דומיין הוא זהות ה"נושאים" (`league_id`/`player`)
ו‑ההעשרה הוויזואלית. שלבי ההעברה:

### שלב 1 — DB (כמעט כפי שהוא)

1. העתק את `analytics_poc.sql`. השאר את event_type/duration/click כפי שהם —
   הם אגנוסטיים.
2. **החלף את מזהי‑התוכן.** `league_id`/`player` הם סתם "על מה קרה האירוע". בפרויקט
   חנות זה יהיה `product_id`/`category`; בבלוג — `post_slug`/`author`. שנה את שמות
   העמודות (או השאר שמות גנריים `subject_a`/`subject_b`) ואת ה‑top_* ב‑summary.
3. **עדכן את ה‑CHECK של `page`** לקבוצת העמודים של האתר החדש.
4. השאר את RLS, ה‑grants, ה‑`SECURITY DEFINER` וה‑ordinals ללא שינוי.

### שלב 2 — Beacon (`analytics.js`)

1. עדכן את `PAGE_BY_FILENAME` לעמודי האתר החדש, ואת `baseFields()` כך שיקרא את
   מזהי‑התוכן החדשים מה‑URL (במקום `?league=`/`?player=`).
2. **החלט על מדיניות הזהות הדו‑מסלולית.** אם אין "קהל‑בית" גאוגרפי מובהק, אפשר
   לקבוע מסלול יחיד (למשל session לכולם, או אפס‑קורלציה לכולם). הקוד כבר מבודד את
   ההחלטה ב‑`send()`.
3. השאר את תשתית הקליקים (A/B/C) כפי שהיא — זו תשתית, לא דומיין.

### שלב 3 — "דקדוק" הלחצנים באתר החדש

1. עבור על כל האתר ומפה כל אינטראקציה לאחת משלוש התבניות (§4). התחל מ‑selectors
   גנריים (tabs, export, menu) — הם מכסים הכי הרבה בהכי מעט עבודה.
2. קבע grammar אחיד `<Section>: <action>[ — <subject>]` כדי שה‑log יהיה קריא.
3. לכל Save/טופס עם old→new — תבנית C (`shabi:interaction` + `data-selftrack`).

### שלב 4 — Dashboard

1. `analytics.html` + `analyticsPage.js` + `analyticsAggregate.js` עוברים כמעט
   כפי שהם — ששת הטאבים, ה‑KPIs, ה‑logs וה‑sessions אגנוסטיים.
2. **הנקודה היחידה שחובה לשכתב:** פונקציות ההעשרה הוויזואלית
   (`clickTargetHtml`, `playerHtml`, `leagueHtml`, `typePillHtml`) — הן מציירות
   דגלי‑שחקנים, badges של תארים ו‑pills של סוג‑ליגה. בפרויקט אחר תחליף אותן
   ברינדור המתאים ל‑subjects שלך (תמונת מוצר, אווטאר כותב וכו'), או תשאיר רינדור
   טקסט פשוט ותסיר את ההעשרה כליל.
3. ודא ש‑`analyticsAggregate.js` נשאר תואם key‑for‑key ל‑`analytics_summary`
   (יש script אימות — שמור על עיקרון זה).

### מה אגנוסטי ומה תלוי‑דומיין — טבלת סיכום

| אגנוסטי (עובר כמעט as‑is) | תלוי‑דומיין (חובה לשכתב) |
|---------------------------|--------------------------|
| event_type (pageview/duration/click) | מזהי‑תוכן (`league_id`/`player` → ה‑subjects שלך) |
| זהות דו‑מסלולית + ניתוב אזור‑זמן | קבוצת ה‑`page` (CHECK) + `PAGE_BY_FILENAME` |
| RLS insert‑only + RPCs + grants | "דקדוק" ה‑`click_target` של הלחצנים |
| תשתית הקליקים A/B/C | העשרה ויזואלית (`clickTargetHtml`, pills, דגלים) |
| ששת הטאבים, KPIs, logs, sessions, ordinals | שער ההתחברות (אם מנגנון ה‑auth שונה) |
| opt‑out לאוטומציה | — |

---

## 8. מלכודות שכבר "נשכו" — לשמר בהעברה

- **capture phase.** המאזין רץ `}, true)` — לפני ה‑handlers. Save עם label דינמי
  **חייב** תבנית C, אחרת ייווצר `Action: Save` גנרי כפול.
- **insert‑only = שורה לא ניתנת לתיקון.** כל מה שצריך להיכתב על אירוע (banners,
  flags) מחושב **סינכרונית לפני** ה‑`send`.
- **זמן תמיד ב‑`Asia/Jerusalem`** (או אזור הקהל שלך) — גבול‑חודש ב‑UTC היה מתייק
  לא נכון אירועים בחלון 21:00–00:00.
- **אל תזהם את ה‑analytics החי** עם אוטומציה — תמיד `shabi:no-analytics` / `?notrack`.
- **`drop function` לפני `create or replace`** כששינית חתימה — אחרת שתי העמסות.

---

🤖 נכתב כעזר העברה; אין בו סודות או מפתחות.
