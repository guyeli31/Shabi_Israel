/**
 * popupContent.js — SINGLE SOURCE OF TRUTH for the site's "?" info-popup texts.
 *
 * Every "?" popup on the site is bilingual (English / Hebrew). This module holds
 * the inner HTML of each popup's two language blocks in one place, so a text edit
 * here updates BOTH the live pages and the "Explanation and Maths" tool that imports it.
 *
 * Consumers:
 *   - the "Explanation and Maths" tool (luck-lab.html) — reads POPUPS to render
 *     the "Question-mark explanations" tab.
 *   - (planned) js/render/dashboardPage.js + js/render/landingPage.js — will be
 *     refactored to build their .popup-lang-en / .popup-lang-he blocks from
 *     getPopup(id).render(lang) instead of inline strings. Until then the inline
 *     copies there remain the live source; keep the two in sync when editing.
 *
 * Shared builders (tables / bell curve) are imported so the figures never drift.
 */

import { prProbabilityTableHtml } from '../compute/championshipPredictor.js';
import { luckContribCurveSvg, luckPriorCurveSvg, luckPosteriorDSvg, luckExampleRowSvg } from '../render/luckContribCurve.js';
import { prGapExampleHistogramSvg, tableValidationExampleHistogramSvg, advantageDistributionExampleHistogramSvg } from '../render/exampleHistograms.js';
import { LUCK_DIST_CUTS, LUCK_PRIOR_S } from '../compute/luckConfidence.js';
import { colorForValue, colorForConfidence } from '../compute/colorScale.js';
import { pmTableHtml } from '../../table-lab/formats/pm/mount.js';

// ---- Typeset math (MathML — native, no library). Single source for the
//      formula lines that used to live in dashboardPage.js / landingPage.js. ----
function mathLine(inner) {
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" dir="ltr">${inner}</math>`;
}

// toFixed() yields an ASCII hyphen-minus (U+002D) — a thin, short glyph that
// reads as non-bold next to bold digits. Swap it for a real MINUS SIGN
// (U+2212), which matches the weight and width of the number it belongs to and
// the &minus; used for the hard-coded negatives elsewhere on the site.
const minusFix = s => String(s).replace('-', '−');

// ---- League-type pill. Popups that name a league category show the SAME themed
//      pill the rest of the UI uses (leagueHeader.js typePill / components.css
//      .league-type-pill) instead of writing the type name as plain text, so the
//      reference is visually identical to the pills on the dashboard/player page.
//      Exported so the dashboard's inline live-copy popup can reuse it verbatim. --
const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC', all: 'All' };
export function leagueTypePill(type) {
    return `<span class="league-type-pill type-${type}">${LEAGUE_TYPE_LABELS[type] || type}</span>`;
}

// ---- Canonical "PR Win-Probability Table" presentation. Every popup that
//      shows the table uses this single block, so the heading + the one-line
//      "how to read it" intro stay identical across all the "?" popups
//      instead of each rewording it. ----
function prTableSection(lang) {
    return lang === 'he' ? `
                <h4>טבלת סיכויי הניצחון לפי PR</h4>
                <p>השורות הן הפרש ה-PR, העמודות הן אורך המשחק; כל תא הוא סיכוי הניצחון (%) של השחקן החזק יותר בשילוב הזה.</p>
                ${prProbabilityTableHtml('he')}` : `
                <h4>The PR Win-Probability Table</h4>
                <p>Rows are PR gap, columns are match length; each cell is the stronger player's win chance (%) at that combination.</p>
                ${prProbabilityTableHtml('en')}`;
}

// ---- Bayesian "Luck Confidence" (metric D) — the CANONICAL luck explainer. --
//      Shared by the dashboard PR-difference popup and the landing luck popup,
//      because both now display the same metric D (see luckConfidence.js).

const D_PRIOR_MATHML = mathLine(`
    <mi>Prior</mi><mo>(</mo><mi>&#952;</mi><mo>)</mo><mo>=</mo>
    <mfrac><mn>1</mn><mrow><mi>s</mi><msqrt><mrow><mn>2</mn><mi>&#960;</mi></mrow></msqrt></mrow></mfrac>
    <msup><mi>e</mi><mrow><mo>&#8722;</mo><msup><mi>&#952;</mi><mn>2</mn></msup><mo>/</mo><mn>2</mn><msup><mi>s</mi><mn>2</mn></msup></mrow></msup>
`);
const D_Q_MATHML = mathLine(`
    <msub><mi>q</mi><mi>i</mi></msub><mo>(</mo><mi>&#952;</mi><mo>)</mo><mo>=</mo>
    <mi>&#963;</mi><mo>(</mo><mi>logit</mi><mo>(</mo><msub><mi>p</mi><mi>i</mi></msub><mo>)</mo><mo>+</mo><mi>&#952;</mi><mo>)</mo>
    <mo>,</mo><mtext>&#160;&#160;</mtext>
    <mi>logit</mi><mo>(</mo><msub><mi>p</mi><mi>i</mi></msub><mo>)</mo><mo>=</mo>
    <mi>ln</mi><mfrac><msub><mi>p</mi><mi>i</mi></msub><mrow><mn>1</mn><mo>&#8722;</mo><msub><mi>p</mi><mi>i</mi></msub></mrow></mfrac>
`);
const D_CONTRIB_MATHML = mathLine(`
    <msub><mi>contrib</mi><mi>i</mi></msub><mo>(</mo><mi>&#952;</mi><mo>)</mo><mo>=</mo>
    <mrow><mo>{</mo><mtable columnalign="left left">
        <mtr><mtd><msub><mi>q</mi><mi>i</mi></msub><mo>(</mo><mi>&#952;</mi><mo>)</mo></mtd><mtd><mtext>&#160;win</mtext></mtd></mtr>
        <mtr><mtd><mn>1</mn><mo>&#8722;</mo><msub><mi>q</mi><mi>i</mi></msub><mo>(</mo><mi>&#952;</mi><mo>)</mo></mtd><mtd><mtext>&#160;loss</mtext></mtd></mtr>
    </mtable></mrow>
`);
const D_POSTERIOR_MATHML = mathLine(`
    <mi>Posterior</mi><mo>(</mo><mi>&#952;</mi><mo>)</mo><mo>&#8733;</mo>
    <mi>Prior</mi><mo>(</mo><mi>&#952;</mi><mo>)</mo><mo>&#8901;</mo>
    <munder><mo>&#8719;</mo><mi>i</mi></munder>
    <msub><mi>contrib</mi><mi>i</mi></msub><mo>(</mo><mi>&#952;</mi><mo>)</mo>
`);
const D_FORMULA_MATHML = mathLine(`
    <mi>D</mi><mo>=</mo><mn>100</mn><mo>&#8901;</mo>
    <mi>P</mi><mo>(</mo><mi>&#952;</mi><mo>&gt;</mo><mn>0</mn><mo>&#8739;</mo><mtext>data</mtext><mo>)</mo>
    <mo>=</mo><mn>100</mn><mo>&#8901;</mo>
    <mfrac>
        <mrow><msubsup><mo>&#8747;</mo><mn>0</mn><mrow><mo>+</mo><mi>&#8734;</mi></mrow></msubsup><mi>Posterior</mi><mo>(</mo><mi>&#952;</mi><mo>)</mo><mi>d</mi><mi>&#952;</mi></mrow>
        <mrow><msubsup><mo>&#8747;</mo><mrow><mo>&#8722;</mo><mi>&#8734;</mi></mrow><mrow><mo>+</mo><mi>&#8734;</mi></mrow></msubsup><mi>Posterior</mi><mo>(</mo><mi>&#952;</mi><mo>)</mo><mi>d</mi><mi>&#952;</mi></mrow>
    </mfrac>
`);

/**
 * The bell-adapted D luck-level table, rendered through the PM (PR Matrix) list
 * format. Each D-range cell is tinted on the shared red→amber→green scale by its
 * own midpoint (0 = very unlucky/red … 100 = very lucky/green). In Hebrew the
 * table right-aligns (pm-rtl) and each numeric range is wrapped dir="ltr" so it
 * keeps its reading order.
 */
function dBandTable(lang) {
    const he = lang === 'he';
    const lucky = LUCK_DIST_CUTS.map(x => 50 + x);
    const unl = LUCK_DIST_CUTS.map(x => 50 - x);
    const labels = he
        ? ['מאוזן', 'בר / חסר מזל במעט', 'בר / חסר מזל', 'בר / חסר מזל מאוד', 'בר / חסר מזל בקיצוניות']
        : ['Balanced', 'Slightly lucky / unlucky', 'Lucky / Unlucky', 'Very lucky / unlucky', 'Extremely lucky / unlucky'];
    const num = s => he ? `<span dir="ltr">${s}</span>` : s;
    const rangeCell = (lo, hi) => ({
        html: num(`${lo.toFixed(1)} &ndash; ${hi.toFixed(1)}`),
        color: colorForValue((lo + hi) / 2, 0, 100),
    });
    const dash = { html: '&mdash;' };

    const rows = [{ cells: [rangeCell(unl[0], lucky[0]), dash, { html: labels[0] }] }];
    for (let i = 0; i < LUCK_DIST_CUTS.length; i++) {
        const hiL = i < LUCK_DIST_CUTS.length - 1 ? lucky[i + 1] : 100;
        const loU = i < LUCK_DIST_CUTS.length - 1 ? unl[i + 1] : 0;
        rows.push({ cells: [rangeCell(lucky[i], hiL), rangeCell(loU, unl[i]), { html: labels[i + 1] }] });
    }
    const cols = he
        ? [{ label: 'D (בר מזל)' }, { label: 'D (חסר מזל)' }, { label: 'רמת מזל' }]
        : [{ label: 'D (lucky)' }, { label: 'D (unlucky)' }, { label: 'Verdict' }];
    return pmTableHtml({ variant: 'list', cols, rows, tableClass: `pm-plain-first${he ? ' pm-rtl' : ''}` });
}

/** The Likelihood legend for the Table Validation popup, in PM list format.
 *  Both columns are tinted on the SAME confidence scale the live validation
 *  table uses (colorForConfidence, capped at 0.5), keyed off a representative
 *  likelihood per band, so the legend reads as the table's own colour key. */
function likelihoodLegendTable(lang) {
    const he = lang === 'he';
    const num = s => he ? `<span dir="ltr">${s}</span>` : s;
    const data = he
        ? [['&lt; 2%', 'קשה להסביר במקרה בלבד'], ['2% &ndash; 5%', 'חריג במידה ניכרת'], ['5% &ndash; 15%', 'חריג במידה קלה'], ['&gt; 15%', 'שונות רגילה וצפויה']]
        : [['&lt; 2%', 'Hard to explain by luck alone'], ['2% &ndash; 5%', 'Notably unusual'], ['5% &ndash; 15%', 'Mildly unusual'], ['&gt; 15%', 'Normal, expected variation']];
    const reps = [0.01, 0.035, 0.10, 0.5];   // representative likelihood per band
    const cols = he ? [{ label: 'Likelihood' }, { label: 'המשמעות' }] : [{ label: 'Likelihood' }, { label: 'What this means' }];
    return pmTableHtml({
        variant: 'list',
        cols,
        rows: data.map(([a, b], i) => {
            const c = colorForConfidence(Math.min(reps[i], 0.5), 0, 0.5);
            return { cells: [{ html: num(a), color: c }, { html: b, color: c }] };
        }),
        tableClass: `pm-plain-first${he ? ' pm-rtl' : ''}`,
    });
}

/**
 * The full, self-contained explanation of the Bayesian Luck-Confidence metric D.
 * Motivation → the luck shift θ → prior(s) → per-match contribution (with three
 * worked example curves) → posterior → D → bell-adapted luck levels.
 */
function luckConfidenceExplainerHtml(lang) {
    const s = LUCK_PRIOR_S.toFixed(1);
    const gWin = luckContribCurveSvg({ p: 0.60, outcome: 'win', title: lang === 'he' ? 'ניצחון, p = 60%' : 'A win when p = 60%' });
    const gLoss = luckContribCurveSvg({ p: 0.60, outcome: 'loss', title: lang === 'he' ? 'הפסד, p = 60%' : 'A loss when p = 60%' });
    const gFav = luckContribCurveSvg({ p: 0.85, outcome: 'win', title: lang === 'he' ? 'ניצחון, p = 85%' : 'A win when p = 85%' });
    const gPrior = luckPriorCurveSvg();
    const dLucky = luckPosteriorDSvg({
        items: [{ p: 0.35, outcome: 'win' }, { p: 0.35, outcome: 'win' }],
        title: lang === 'he' ? 'D > 50 — בר מזל' : 'D > 50 — lucky',
        subtitle: lang === 'he' ? '2 ניצחונות כנחות (p = 35%)' : '2 wins as the underdog (p = 35%)',
    });
    const dUnlucky = luckPosteriorDSvg({
        items: [{ p: 0.75, outcome: 'loss' }, { p: 0.75, outcome: 'loss' }],
        title: lang === 'he' ? 'D < 50 — חסר מזל' : 'D < 50 — unlucky',
        subtitle: lang === 'he' ? '2 הפסדים כמועדף (p = 75%)' : '2 losses as the favourite (p = 75%)',
    });

    if (lang === 'he') {
        return `
            <h4>משמעות Luck</h4>
            <p>האם, בהינתן רמת המשחק של השחקן אל מול רמת יריביו, הוא ניצח <b>יותר</b> ממה שהיה צפוי, או <b>פחות</b>? רשומת ניצחונות־הפסדים גולמית לא יכולה לענות על זה — ניצחון על יריב חזק שווה יותר מניצחון על חלש. המדד הזה משקלל כל תוצאת משחק לפי כמה היא הייתה סבירה מלכתחילה, ואז מדווח — כ<b>אחוזון 0–100</b> — עד כמה אנחנו בטוחים שהשחקן בר מזל או חסר מזל. <b>50</b> = בדיוק על פי המודל. מספר המשחקים במדגם משפיע על האחוזון: אצל שחקן עם שני ניצחונות שנראים ברי-מזל המדד קרוב הרבה יותר ל-50 מאשר אצל שחקן עם עשרים ניצחונות כאלה — ככל שנאספו יותר משחקים, כך אפשר להיות בטוחים יותר.</p>

            <h4>הפיתוח המתמטי</h4>
            <p class="popup-sample-note">מכאן ואילך מוצג הפיתוח המתמטי של המדד — אפשר לדלג עליו למי שרוצה רק את המשמעות.</p>
            <h5>1 · הסקאלה הנסתרת של המזל, θ</h5>
            <p>דמיינו "חוגה" נסתרת אחת, <b>θ</b>, שהזיזה את כל משחקי השחקן באותו כיוון, והמדידה שלה היא ביחידות log-odds. ערך חיובי (<b>θ &gt; 0</b>) מציין שהשחקן בר מזל, ערך שלילי (<b>θ &lt; 0</b>) — חסר מזל, ואפס (<b>θ = 0</b>) — בדיוק על פי המודל. איננו יודעים את θ — במקום זאת אנחנו מסיקים <b>התפלגות שלמה</b> של הערכים הסבירים עבורה.</p>

            <h5>2 · נקודת הפתיחה: ה-Prior</h5>
            <p>לפני שמסתכלים על תוצאה כלשהי, אנחנו מניחים ש-θ קרובה לוודאי לערך קטן: פעמון שמרוכז סביב 0 ברוחב <i>s</i>.</p>
            <div class="corr-formula">${D_PRIOR_MATHML}</div>
            <p><b>s = ${s}</b> קובע כמה מזל נראה לנו סביר מראש. הוא גם מה שמונע ממדגם זעיר להצהיר בטעות "100% בר מזל": כל עוד לא נאספו הרבה משחקים, ה-Prior מושך את המסקנה בחזרה לכיוון 0.</p>
            <div class="contrib-grid">${gPrior}</div>
            <p>הגרף מראה את ה-Prior לשלושה ערכי <i>s</i>: קטן יותר (<span style="color:#a855f7">סגול</span>) = פעמון צר וגבוה, המניח שהמזל כמעט תמיד קטן; גדול יותר (<span style="color:#14b8a6">טורקיז</span>) = פעמון רחב ושטוח, שמתיר מראש גם לערכי θ גדולים יותר להיחשב סבירים. הקו המלא הוא ברירת המחדל <b>s = 1</b>. שטח כל עקומה הוא 1 (זו התפלגות הסתברות).</p>

            <h5>3 · התרומה של כל משחק</h5>
            <p>לכל משחק לוקחים את סיכוי הניצחון הצפוי <i>p<sub>i</sub></i> (מ-<i>PR Win-Probability Table</i>), הופכים אותו ל-log-odds, ומזיזים אותו ב-θ:</p>
            <div class="corr-formula">${D_Q_MATHML}</div>
            <p>ואז שואלים עד כמה θ נתונה <b>מסבירה</b> את התוצאה בפועל:</p>
            <div class="corr-formula">${D_CONTRIB_MATHML}</div>
            <p>ניצחון הופך ערכי θ גדולים ל<b>אמינים יותר</b> (העקומה עולה); הפסד הופך ערכי θ קטנים לאמינים יותר (העקומה יורדת):</p>
            <div class="contrib-grid">${gWin}${gLoss}${gFav}</div>
            <p>שימו לב לגרף השלישי: כאשר השחקן כבר היה מועדף בסיכוי של 85%, ניצחון כמעט אינו מזיז את העקומה — התוצאה הייתה <b>צפויה</b>, ולכן היא כמעט אינה מלמדת אותנו על מזל. לעומת זאת, ניצחון של המוחלש (או הפסד של המועדף) הוא מפתיע, ומטה את העקומה בחדות.</p>

            <h5>4 · צירוף הכול: ה-Posterior</h5>
            <p>כופלים את ה-Prior בתרומה של כל משחק:</p>
            <div class="corr-formula">${D_POSTERIOR_MATHML}</div>
            <p>בשונה מה-Prior, העקומה הזו <b>אינה</b> מנורמלת מחדש — השטח שמתחתיה מתכווץ עם כל משחק שמכפיל אותה, ולכן יותר משחקים נותנים תוצאה חדה ובטוחה יותר. אבל למדד עצמו הנרמול לא משנה: הוא <b>יחס שטחים</b>, וקבוע הכפל מצטמצם.</p>

            <h5>5 · המדד D</h5>
            <p>D הוא פשוט חלק השטח של ה-Posterior שיושב <b>מימין ל-θ=0</b> — ההסתברות שהשחקן באמת בר מזל — מוצג בסקאלה 0–100:</p>
            <div class="corr-formula">${D_FORMULA_MATHML}</div>
            <p>ה-Prior תמיד משאיר משקל הסתברותי לשני הצדדים, ולכן אפילו שחקן שניצח את <b>כל</b> משחקיו לעולם לא יגיע ל-100: ככל שהרשומה שלו נשענת על פחות משחקים, כך המדד נמשך חזק יותר בחזרה לעבר 50. משום כך אין צורך באזהרת "מדגם קטן" נפרדת — גודל המדגם כבר בא לידי ביטוי במספר עצמו.</p>
            <div class="contrib-grid">${dLucky}${dUnlucky}</div>
            <p>שני הגרפים מראים את אותו רעיון בשני כיוונים מנוגדים. ה-Prior מצויר מאחור (מקווקו, דהוי). השטח <span style="color:var(--color-win)">הירוק</span> מימין ל-θ=0 הוא ההסתברות שהשחקן בר מזל, וה<span style="color:var(--color-loss)">אדום</span> משמאל — שהוא חסר מזל; <b>D</b> הוא פשוט אחוז השטח הירוק.</p>
            <ul>
                <li><b>D &gt; 50 (בר מזל):</b> שני ניצחונות כשהשחקן היה הנחות (p = 35%) דוחפים את ה-Posterior ימינה, כך שרוב השטח ירוק.</li>
                <li><b>D &lt; 50 (חסר מזל):</b> שני הפסדים כשהשחקן היה המועדף (p = 75%) דוחפים אותו שמאלה, כך שרוב השטח אדום.</li>
            </ul>
            <p>שימו לב שאף אחד מהם אינו מגיע ל-0 או ל-100: עם שני משחקים בלבד, ה-Prior עדיין מושך את שתי התוצאות אל עבר האמצע.</p>

            <h4>רמות המזל</h4>
            <p>כל אחוזון מסווג לתיאור מילולי של רמת המזל, לפי התחומים הבאים:</p>
            ${dBandTable('he')}
        `;
    }
    return `
        <h4>What Luck means</h4>
        <p>Did this player win <b>more</b> than their matches warranted, or <b>less</b>? A raw win-loss record can't tell you — beating a strong opponent is worth more than beating a weak one. This score weighs every result by how likely it was in the first place, then reports — as a <b>0–100 percentile</b> — how confident we can be that the player has been running <i>above</i> the model (lucky) rather than below it (unlucky). <b>50</b> means dead on model. Sample size is baked into the number itself: a player with two lucky wins lands far closer to 50 than one with twenty.</p>

        <h4>The mathematical derivation</h4>
        <p class="popup-sample-note">From here on is the metric's mathematical derivation — skip it if you only want the meaning.</p>
        <h5>1 · The hidden luck dial, θ</h5>
        <p>Picture one hidden dial, <b>θ</b>, that nudged all of this player's matches the same way, measured in log-odds. <b>θ &gt; 0</b> = ran hot (lucky), <b>θ &lt; 0</b> = ran cold, <b>θ = 0</b> = exactly on model. We never observe θ — instead we infer a <i>whole distribution</i> of plausible values for it.</p>

        <h5>2 · The starting point: the prior</h5>
        <p>Before looking at any result, we assume θ is probably small: a bell centred on 0 with width <i>s</i>.</p>
        <div class="corr-formula">${D_PRIOR_MATHML}</div>
        <p><b>s = ${s}</b> sets how much luck we think is plausible a priori. It's also what stops a tiny sample from screaming "100% lucky": until many matches accumulate, the prior pulls the verdict back toward 0.</p>
        <div class="contrib-grid">${gPrior}</div>
        <p>The graph shows the prior for three values of <i>s</i>: smaller (<span style="color:#a855f7">purple</span>) is a tall, narrow bell that assumes luck is almost always small; larger (<span style="color:#14b8a6">teal</span>) is wide and flat, letting luck range further. The solid line is the default <b>s = 1</b>. Each curve encloses an area of 1 (it's a probability distribution).</p>

        <h5>3 · Each match's contribution</h5>
        <p>For each match we take the model win-chance <i>p<sub>i</sub></i> (from the <i>PR Win-Probability Table</i>), turn it into log-odds, and shift it by θ:</p>
        <div class="corr-formula">${D_Q_MATHML}</div>
        <p>then ask how well a given θ <i>explains</i> the result that actually happened:</p>
        <div class="corr-formula">${D_CONTRIB_MATHML}</div>
        <p>A win makes larger θ values <b>more credible</b> (the curve rises); a loss makes smaller θ more credible (the curve falls):</p>
        <div class="contrib-grid">${gWin}${gLoss}${gFav}</div>
        <p>Notice the third graph: when the player was already an 85% favourite, winning barely moves the curve — the result was <i>expected</i>, so it carries almost no luck information. An underdog winning (or a favourite losing) tilts the curve sharply instead. That curvature — how surprising each result is — is the whole point.</p>

        <h5>4 · Putting it together: the posterior</h5>
        <p>Multiply the prior by every match's contribution:</p>
        <div class="corr-formula">${D_POSTERIOR_MATHML}</div>
        <p>Unlike the prior, this curve is <b>not</b> re-normalised — its area shrinks as each match multiplies it, which is why more matches give a sharper, more confident verdict. The metric itself doesn't care about that: it's a <i>ratio of areas</i>, so the scaling constant cancels.</p>

        <h5>5 · The metric D</h5>
        <p>D is simply the share of the posterior's area sitting <b>to the right of θ=0</b> — the probability the player truly ran hot — put on a 0–100 scale:</p>
        <div class="corr-formula">${D_FORMULA_MATHML}</div>
        <p>Because the prior always keeps weight on both sides, even an all-win record lands below 100, pulled toward 50 by however few games it rests on. So there's no separate "small sample" cutoff — the sample size is already folded into the number.</p>
        <div class="contrib-grid">${dLucky}${dUnlucky}</div>
        <p>Both graphs show the same idea in opposite directions. The prior is drawn faintly behind (dashed). The <span style="color:var(--color-win)">green</span> area to the right of θ=0 is the probability the player ran hot; the <span style="color:var(--color-loss)">red</span> to the left, that they ran cold; <b>D</b> is just the green area's share.</p>
        <ul>
            <li><b>D &gt; 50 (lucky):</b> two wins as the underdog (p = 35%) push the posterior right, so most of the area is green.</li>
            <li><b>D &lt; 50 (unlucky):</b> two losses as the favourite (p = 75%) push it left, so most of the area is red.</li>
        </ul>
        <p>Notice neither reaches 0 or 100: on just two matches, the prior still pulls both results toward the middle.</p>

        <h4>Luck levels</h4>
        <p>Each percentile is sorted into a plain-language luck level, according to the bands below:</p>
        ${dBandTable('en')}
    `;
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/**
 * The player page's per-series μ/σ explainer (Total PR ↔ Result → Gaussian fit).
 *
 * Unlike the dashboard's `gaussian` popup — whose live copy still sits inline in
 * dashboardPage.js — this one is genuinely single-source: the live page AND the
 * catalog entry below both call this function, so the wording can only be edited
 * here. Returns the inner HTML of ONE language block; the caller wraps it in
 * `.popup-lang-<lang>`.
 *
 * The sign is always "this player vs their opponent" (gap = opponent's PR minus
 * their own), so the sentence follows the series being fitted: in Wins, μ is how
 * much better they played in matches they won.
 */
export function playerGaussianSeriesHtml(lang, { displayName, seriesLabel, mean, std, games }) {
    const lo = minusFix((mean - std).toFixed(2)), hi = minusFix((mean + std).toFixed(2));
    const abs = Math.abs(mean).toFixed(2);
    const better = mean >= 0;
    const name = esc(displayName);
    const label = esc(seriesLabel);

    if (lang === 'he') {
        const dirHe = better ? 'טוב יותר' : 'גרוע יותר';
        const scopeHe = { Wins: 'המשחקים שניצח', Losses: 'המשחקים שהפסיד', All: 'משחקיו' }[seriesLabel] || 'המשחקים';
        return `
            <h4>${label} &mdash; מה &mu; ו-&sigma; אומרים כאן?</h4>
            <p><b>&mu; (ממוצע) = <span dir="ltr">${minusFix(mean.toFixed(2))}</span></b>: בממוצע, על פני ${games} ${scopeHe}, ${name} שיחק בכ-${abs} נקודות PR ${dirHe} מיריבו באותו משחק.</p>
            <p><b>&sigma; (סטיית תקן) = ${std.toFixed(2)}</b>: בכ-66.7% מ-${games} המשחקים הפרש ה-PR היה בין <b><span dir="ltr">${lo}</span></b> ל-<b><span dir="ltr">${hi}</span></b>.</p>
        `;
    }
    const dirEn = better ? 'better' : 'worse';
    const scopeEn = { Wins: 'matches they won', Losses: 'matches they lost', All: 'matches' }[seriesLabel] || 'matches';
    return `
        <h4>${label} &mdash; what do &mu; and &sigma; mean here?</h4>
        <p><b>&mu; (mean) = ${minusFix(mean.toFixed(2))}</b>: on average, across the ${games} ${scopeEn}, ${name} played about ${abs} PR points ${dirEn} than their opponent that match.</p>
        <p><b>&sigma; (standard deviation) = ${std.toFixed(2)}</b>: in about 66.7% of those ${games} matches the PR gap was between <b>${lo}</b> and <b>${hi}</b>.</p>
    `;
}

// ---------------------------------------------------------------------------
//  The popups. Each `render(lang)` returns the inner HTML for that language —
//  exactly what belongs inside `.popup-lang-<lang>` in the live pages.
// ---------------------------------------------------------------------------

export const POPUPS = [
    // ============ 1 · Championship Predictor (dashboard) ============
    {
        id: 'predictor', page: 'dashboard',
        title: { en: 'Championship Predictor', he: 'מנוע החיזוי לאליפות' },
        render(lang) {
            return lang === 'he' ? `
                <h3>איך זה עובד</h3>
                <p>מנוע החיזוי משחק את כל המשחקים שנותרו בליגה <b>אלפי פעמים</b>, כל פעם עם תוצאות מעט שונות, וסופר כמה פעמים כל שחקן מסיים ראשון. שחקן שזוכה באליפות ב-6 מתוך כל 10 עונות מדומות, למשל, מקבל סיכוי של <b>60%</b>. ככל שנותרו יותר משחקים, כך המרוץ פתוח יותר.</p>
                <h4>כמה חזק כל שחקן?</h4>
                <p>העוצמה של שחקן נגזרת מה-<b>PR</b> העדכני שלו (נמוך יותר = טוב יותר). אבל אף אחד לא משחק באותה רמה בכל משחק, אז בכל משחק מדומה כל שחקן משחק ברמה קצת מעל או מתחת לרמתו הרגילה. השונות הזו מאפשרת הפתעות — למועדף יכול להיות משחק חלש, והפוך.</p>
                <h4>מי מנצח במשחק בודד?</h4>
                <p>שני דברים קובעים את הסיכויים: <b>גודל הפער ב-PR</b> בין השחקנים, ו<b>אורך המשחק</b>. פער גדול יותר מטה את הסיכויים לטובת השחקן החזק, ומשחקים ארוכים יותר נותנים למועדף יותר מקום להתרחק (המזל מתאזן על פני יותר משחקים).</p>
                ${prTableSection('he')}
                <h4>שבירת שוויון</h4>
                <p>כששחקנים מסיימים שווים בניקוד הראשי של הליגה, השוויון נשבר בצורה שונה בהתאם לסוג הליגה:</p>
                <ul>
                    <li>ליגות ${leagueTypePill('doubling')} ו-${leagueTypePill('ubc')}: השחקן עם ה-<b>PR הממוצע</b> הטוב יותר (נמוך יותר) לאורך העונה מדורג גבוה יותר.</li>
                    <li>ליגות ${leagueTypePill('regular')}: השוויון נשבר קודם לפי התוצאה ה<b>ישירה</b> בין השחקנים המעורבים, אחר כך לפי <b>הפרש הנקודות</b> הכולל, ולבסוף לפי סדר אלפביתי.</li>
                </ul>
                <h4>טווח טעות</h4>
                <p>מכיוון שהתוצאה מבוססת על סימולציה אקראית, האחוז המוצג של המוביל נושא אי-ודאות קטנה. ה<b>± המוצג</b> הוא טווח ביטחון של 95% — ריצת סימולציות נוספות מצמצמת אותו. הוא משקף רק את האקראיות של הסימולציה עצמה.</p>
            ` : `
                <h3>How It Works</h3>
                <p>The predictor plays out all the matches still left in the league <b>thousands of times over</b>, each time with slightly different results, and simply counts how often each player ends up on top. A player who wins the title in, say, 6 out of every 10 imagined seasons gets a <b>60%</b> chance. The more matches are still to be played, the more open the race.</p>
                <h4>How strong is each player?</h4>
                <p>A player's strength comes from their recent <b>PR</b> (lower is better). But nobody plays exactly the same every match, so in each imagined match a player performs a little above or below their usual level. That built-in variation is what keeps upsets possible — a favourite can have a weak match, and vice versa.</p>
                <h4>Who wins a single match?</h4>
                <p>Two things decide the winner's odds: <b>how big the PR gap is</b> between the players, and <b>how long the match is</b>. A bigger gap favours the stronger player, and longer matches give the favourite more room to pull ahead (luck evens out over more games).</p>
                ${prTableSection('en')}
                <h4>Breaking a tie</h4>
                <p>When players finish level on the league's main score, the tie is settled differently depending on the league:</p>
                <ul>
                    <li>${leagueTypePill('doubling')} &amp; ${leagueTypePill('ubc')} leagues: the player with the better (lower) <b>average PR</b> across the season comes out ahead.</li>
                    <li>${leagueTypePill('regular')} leagues: the tie is settled first by the <b>head-to-head</b> result between the tied players, then by overall <b>points difference</b>, and finally alphabetically.</li>
                </ul>
                <h4>Margin of Error</h4>
                <p>Because the result comes from random simulation, the leader's percentage carries a small uncertainty. The <b>± figure</b> shown is a 95% confidence range — run more simulations and it shrinks. It reflects the randomness of the simulation only.</p>
            `;
        },
    },

    // ============ 2 · What If (dashboard) ============
    {
        id: 'whatif', page: 'dashboard',
        title: { en: 'What If', he: 'מה אם' },
        render(lang) {
            return lang === 'he' ? `
                <h4>מה אם</h4>
                <p><b>למה זה כאן:</b> מרוץ האליפות תלוי בתוצאות שעוד לא נקבעו. טבעי לשאול "מה היה קורה אילו המשחק הזה היה נגמר אחרת?" — הכלי הזה נותן לכם לענות על השאלה הזו בעצמכם: לקבע תוצאות, ולראות מיד איך סיכויי האליפות זזים.</p>
                <p>בחרו כל משחק מתוזמן בליגה וכפו עליו תוצאה (A מנצח, B מנצח, או לא שוחק). ניתן להוסיף כמה משחקים שרוצים, ואז ללחוץ <b>הרץ סימולציה</b> כדי לראות איך סיכויי האליפות היו משתנים בתרחיש החלופי הזה.</p>
                <ul>
                    <li>משחקים ששוחקו כבר נטענים עם התוצאה האמיתית שלהם וניתן לדרוס אותה.</li>
                    <li>משחקים שלא שוחקו מתחילים כ-<i>לא שוחק</i> — בחרו מנצח כדי לקבוע את התוצאה.</li>
                    <li>החיפוש של שחקן B מצטמצם לשחקנים שיש להם משחק מתוזמן משותף עם שחקן A.</li>
                    <li><b>הרצה מ־</b> מאפשרת להתחיל את התרחיש מגרסה שמורה קודמת של הליגה במקום מהמצב האחרון.</li>
                </ul>
                <p>מנוע החישוב זהה למנוע החיזוי האמיתי שלמעלה — רק הקלט שונה. התוצאות ספקולטיביות ותלויות בבחירות שלכם.</p>
            ` : `
                <h4>What If</h4>
                <p><b>Why it's here:</b> the title race hinges on results that haven't happened yet. It's natural to ask "what would happen if this match went the other way?" — this tool lets you answer that yourself: lock in outcomes and watch the championship odds move in real time.</p>
                <p>Pick any scheduled match in the league and force its outcome (A wins, B wins, or Not Played). Add as many matches as you like, then <b>Run Simulation</b> to see how the championship odds would change in that alternate scenario.</p>
                <ul>
                    <li>Already-played matches load with their real result and can be overridden.</li>
                    <li>Unplayed matches start as <i>Not Played</i> — pick a winner to lock the outcome.</li>
                    <li>Player B's search narrows to players who share a scheduled match with Player A.</li>
                    <li><b>Run from</b> lets you start the scenario from an earlier saved version of the league instead of the latest state.</li>
                </ul>
                <p>The engine is the same as the real predictor above — only the inputs differ. Results are speculative and depend on your choices.</p>
            `;
        },
    },

    // ============ 3 · Player PR ↔ Result Correlation (dashboard) ============
    {
        id: 'pr-corr', page: 'dashboard',
        title: { en: 'Player PR difference ↔ Result ↔ Luck', he: 'שחקן: הפרש PR ↔ תוצאה ↔ מזל' },
        render(lang) {
            return lang === 'he' ? `
                <p><b>למה זה כאן:</b> האם שחקן ניצח כי שיחק טוב יותר, או כי הקוביות האירו לו פנים? החלק הזה בוחן, לכל שחקן, את הקשר בין איכות המשחק שלו (לפי PR) לבין השאלה אם ניצח — ומזקק מכך ציון מזל יחיד.</p>
                <h4>רקע</h4>
                <p>לכל משחק יש סיכוי ניצחון צפוי לשחקן החזק יותר, הנקבע על ידי שני משתנים: <b>הפרש ה-PR</b> בין שני השחקנים, ואורך המשחק. זהו מודל קבוע ומפורסם (שאינו מותאם לתוצאות הליגה הזו עצמה) — אותה טבלה משמשת לדירוג כל משחק בעמוד הזה, ללא תלות במי שיחק אותו או מתי.</p>
                ${prTableSection('he')}
                <h4>איך קוראים את הגרף</h4>
                <p>לכל שחקן קיים גרף משלו, עם נקודה אחת על הגרף עבור כל משחק ששיחק, הממוקמת לפי <b>יתרון ה-PR</b> שלו באותו משחק — ה-PR של היריב פחות שלו (PR נמוך יותר = פחות טעויות, כך שיתרון חיובי משמעותו שהשחקן עצמו שיחק את המשחק ברמה טובה יותר מיריבו). נקודה שנמצאת יותר <b>ימינה</b> אומרת שהשחקן שיחק טוב מהיריב באותו משחק; יותר <b>שמאלה</b> אומרת שהיריב שיחק טוב ממנו. <span style="color:var(--color-win)">ירוק</span> = ניצחון, <span style="color:var(--color-loss)">אדום</span> = הפסד.</p>
                <p>בגרף הדוגמה שלמטה יש לשחקן שלושה משחקים: <span style="color:var(--color-win)">ניצחון</span> ביתרון <span dir="ltr">+5</span> (שיחק הרבה יותר טוב — ניצחון צפוי), <span style="color:var(--color-win)">ניצחון</span> ביתרון <span dir="ltr">&minus;3</span> (שיחק פחות טוב ובכל זאת ניצח — תוצאה מפתיעה שנזקפת למזל טוב), ו<span style="color:var(--color-loss)">הפסד</span> ביתרון <span dir="ltr">+2</span> (היה מעט עדיף אך הפסיד — חוסר מזל קל). <b>מעל</b> הגרף מופיע מדד ה-<b>Luck</b> בדיוק כפי שהוא מוצג בדשבורד — הוא מסכם את שלוש הנקודות למספר יחיד בסקאלה 0–100. כאן ההפתעה החיובית גוברת על ההפסד הקל, ולכן ה-Luck יוצא <b>63</b> (בר מזל במעט). המשמעות המלאה של המדד מוסברת בהמשך.</p>
                ${luckExampleRowSvg({ dots: [{ adv: 5, pWin: 0.623, win: true }, { adv: -3, pWin: 0.425, win: true }, { adv: 2, pWin: 0.55, win: false }] })}
                ${luckConfidenceExplainerHtml('he')}
            ` : `
                <p><b>Why it's here:</b> did a player win because they outplayed their opponent, or because the dice were kind? This section lines up, for each player, how well they played each match (by PR) against whether they actually won it — and distils a single luck score from it.</p>
                <h4>Background</h4>
                <p>Every match has an expected win chance for the stronger player, determined by two inputs: the <b>PR gap</b> between the two players, and the match length. This is a fixed, published model (not fit to this league's own results) &mdash; the same table is used to grade every match on this page, regardless of who played it or when.</p>
                ${prTableSection('en')}
                <h4>Reading the graph</h4>
                <p>Each player has their own graph, with one dot for every match they've played, placed by that player's <b>PR advantage</b> in the match &mdash; the opponent's PR minus their own (a lower PR means fewer mistakes, so a positive advantage means the player played the match at a higher level than their opponent). A dot further <b>right</b> means the player outplayed their opponent that match; further <b>left</b> means they were outplayed. <span style="color:var(--color-win)">Green</span> = win, <span style="color:var(--color-loss)">red</span> = loss.</p>
                <p>In the example below the player has three matches: a <span style="color:var(--color-win)">win</span> at advantage <span dir="ltr">+5</span> (played much better &mdash; an expected win), a <span style="color:var(--color-win)">win</span> at advantage <span dir="ltr">&minus;3</span> (was outplayed yet still won &mdash; a surprise, good luck), and a <span style="color:var(--color-loss)">loss</span> at advantage <span dir="ltr">+2</span> (was slightly better but lost &mdash; mild bad luck). <b>Above</b> the graph is the <b>Luck</b> metric exactly as the dashboard shows it &mdash; it sums the three dots into one 0–100 number. Here the upset win outweighs the mild loss, so Luck comes out <b>63</b> (Slightly lucky). The metric's full meaning is explained below.</p>
                ${luckExampleRowSvg({ dots: [{ adv: 5, pWin: 0.623, win: true }, { adv: -3, pWin: 0.425, win: true }, { adv: 2, pWin: 0.55, win: false }] })}
                ${luckConfidenceExplainerHtml('en')}
            `;
        },
    },

    // ============ 4 · League PR ↔ Result Correlation (dashboard) ============
    {
        id: 'league-corr', page: 'dashboard',
        title: { en: 'League PR difference ↔ Result', he: 'ליגה: הפרש PR ↔ תוצאה' },
        render(lang) {
            return lang === 'he' ? `
                <p><b>למה זה כאן:</b> במבט על כלל הליגה — האם השחקן הטוב יותר באמת מנצח לעתים קרובות יותר, על פני מאות משחקים? כאן בודקים את זה במצטבר.</p>
                <h4>רקע</h4>
                <p>לכל משחק יש סיכוי ניצחון צפוי לשחקן החזק יותר, הנקבע לפי <b>הפרש ה-PR</b> בין שני השחקנים ואורך המשחק &mdash; מודל קבוע ומפורסם, שאינו מותאם לתוצאות הליגה הזו עצמה. החלק הזה בוחן את המודל הזה באופן מצרפי, על פני הרבה משחקים בבת אחת, ולא שחקן אחד בכל פעם.</p>
                ${prTableSection('he')}
                <h4>החישוב</h4>
                <p>עבור כל משחק, מחושב ערך <b>יתרון</b>:</p>
                <p style="text-align:center"><i>יתרון</i> = <i>PR</i><sub>מפסיד</sub> &minus; <i>PR</i><sub>מנצח</sub></p>
                <p>יתרון חיובי אומר שלמנצח היה גם ה-PR הטוב יותר (הנמוך יותר) באותו משחק &mdash; המועדף ניצח, כפי שהטבלה הייתה חוזה. יתרון שלילי אומר שהייתה הפתעה: למנצח היה ה-PR הגרוע יותר. המשחקים מקובצים לאחר מכן ל-bins ברוחב נקודת PR אחת לפי ערך היתרון שלהם, וגובה כל bin הוא חלקם (%) של כלל המשחקים שנופלים בו.</p>
                <p><b>הליגה &mdash; כל המשחקים</b> מרכזת את כל המשחקים ששוחקו בליגה הזו. <b>כל משחקי הליגות</b> מרכזת את כל המשחקים ששוחקו אי פעם בכל הליגות מ<b>אותו סוג ליגה ואותו אורך משחק</b> (פער PR נתון משמעותי יותר במשחק ארוך יותר, כך שערבוב אורכי משחק שונים היה מטשטש את ההשוואה). למשחקים עם תוצאה טכנית אין PR אמיתי, והם אינם נכללים באף אחת מהשורות.</p>
                <h4>איך קוראים את הגרף</h4>
                <p>הציר האופקי הוא ערך ה<b>יתרון</b> בנקודות PR: ככל שנעים ימינה היתרון חיובי יותר (המנצח שיחק טוב יותר מיריבו &mdash; תוצאה צפויה), וככל שנעים שמאלה הוא שלילי יותר (הפתעה &mdash; המנצח דווקא שיחק גרוע יותר). הציר האנכי הוא <b>שיעור המשחקים</b> (%) שנפלו בכל עמודה. שתי השורות חולקות את אותו ציר אופקי, כדי שניתן יהיה להשוות ביניהן.</p>
                ${advantageDistributionExampleHistogramSvg('he')}
                <h4>הבקרות</h4>
                <ul>
                    <li><b>הזזת פער PR</b> (בשורת "כל הליגות" בלבד) מוסיפה קבוע ליתרון של כל משחק לפני שההיסטוגרמה, התאמת הגאוס וטבלת אימות המודל למטה מחושבות מחדש &mdash; דרך לבדוק האם נקודת הכיול של המודל מוזזת בכמות קבועה.</li>
                    <li><b>חתוך ל-99%</b> מקרב את התצוגה של השורה לאמצע 99% מהמשחקים שלה, ומסתיר את העמודות החריגות &mdash; לתצוגה בלבד, הנתונים עצמם אינם מושפעים.</li>
                    <li><b>התאמת גאוס</b> מציגה עקומה נורמלית שמותאמת לממוצע ולסטיית התקן של אותה שורה (מוצגים כ-&mu; ו-&sigma;), בתוספת קווים מקווקווים בממוצע ובמרחק &plusmn;1 סטיית תקן &mdash; הפניה חזותית בלבד, לא טענה שערכי היתרון אכן מתפלגים נורמלית. מנוטרל כשלשורה אין עדיין מספיק משחקים שממוצע/סטיית תקן יהיו משמעותיים.</li>
                    <li><b>אימות טבלה</b> (בשורת "כל הליגות" בלבד) בודק, פער אחר פער, כמה פעמים המועדף ניצח בפועל לעומת מה ש-<i>PR Win-Probability Table</i> חוזה, עם קריאת סבירות לכך עד כמה תוצאת כל פער מפתיעה.</li>
                </ul>
            ` : `
                <p><b>Why it's here:</b> zoom out from one player to the whole league — does the better player actually win more often, across hundreds of matches? This section checks that in aggregate.</p>
                <h4>Background</h4>
                <p>Every match has an expected win chance for the stronger player, determined by the <b>PR gap</b> between the two players and the match length &mdash; a fixed, published model, not fit to this league's own results. This section looks at that model in aggregate, across many matches at once, rather than one player at a time.</p>
                ${prTableSection('en')}
                <h4>The calculation</h4>
                <p>For every match, an <b>advantage</b> value is computed:</p>
                <p style="text-align:center"><i>advantage</i> = <i>PR</i><sub>loser</sub> &minus; <i>PR</i><sub>winner</sub></p>
                <p>A positive advantage means the winner also had the better (lower) PR that match &mdash; the favourite won, as the table would predict. A negative advantage means an upset: the winner had the worse PR. Matches are then grouped into 1-PR-point-wide bins by their advantage value, and each bin's height is the share (%) of all matches falling in it.</p>
                <p><b>League &mdash; all matches</b> pools every match played in this league. <b>All League Matches</b> pools every match ever played in every league of the <i>same league type and the same match length</i> (a given PR gap matters more over a longer match, so mixing match lengths would blur the comparison). Matches with a technical result carry no real PR and are excluded from both rows.</p>
                <h4>Reading the graph</h4>
                <p>The horizontal axis is the <b>advantage</b> value in PR points: further right, the advantage is more positive (the winner outplayed their opponent &mdash; an expected result); further left, more negative (an upset &mdash; the winner actually played worse). The vertical axis is the <b>share of matches</b> (%) falling in each bar. Both rows share the same horizontal axis so they can be compared against each other.</p>
                ${advantageDistributionExampleHistogramSvg('en')}
                <h4>The controls</h4>
                <ul>
                    <li><b>PR-gap shift</b> (all-time row only) adds a constant to every match's advantage before the histogram, Gaussian fit, and Table Validation table below are recomputed &mdash; a way to test whether the model's calibration point is off by a fixed amount.</li>
                    <li><b>Trim to 99%</b> zooms a row's own view in to the middle 99% of its matches, hiding the outlier bins &mdash; display only, the underlying data is unaffected.</li>
                    <li><b>Gaussian fit</b> overlays a normal curve fitted to that row's own mean and standard deviation (shown as &mu; and &sigma;), plus dashed lines at the mean and at &plusmn;1 standard deviation &mdash; a visual reference only, not a claim that advantage values are actually normally distributed. Disabled when a row doesn't have enough matches yet for a mean/standard deviation to be meaningful.</li>
                    <li><b>Table Validation</b> (all-time row only) checks, gap by gap, how often the favourite actually won against what the <i>PR Win-Probability Table</i> predicts, with a likelihood read on how surprising each gap's result is.</li>
                </ul>
            `;
        },
    },

    // ============ 5 · Luck Percentile (landing page) ============
    {
        id: 'luck-percentile', page: 'landing',
        title: { en: 'Luck Percentile', he: 'אחוזון מזל' },
        render(lang) {
            return lang === 'he' ? `
                <p>לכל שחקן ברשימה מוצג <b>אחוזון מזל</b> יחיד, 0–100, המסכם את כל משחקיו המדורגים בכל הליגות: עד כמה אנחנו בטוחים שהוא בר מזל (מעל המודל) או חסר מזל (מתחתיו), אחרי ששוקללה חוזק היריב בכל משחק. להלן החישוב המלא.</p>
                ${prTableSection('he')}
                ${luckConfidenceExplainerHtml('he')}
            ` : `
                <p>Every player in the list gets a single <b>Luck Percentile</b>, 0–100, summarising all of their rated matches across every league: how confident we are that they've been running above the model (lucky) or below it (unlucky), after weighing each opponent's strength. The full calculation follows.</p>
                ${prTableSection('en')}
                ${luckConfidenceExplainerHtml('en')}
            `;
        },
    },

    // ============ 5b · Total PR ↔ Result (player page) ============
    {
        id: 'player-pr-result', page: 'player',
        title: { en: 'Total PR difference ↔ Result', he: 'סך הכול: הפרש PR ↔ תוצאה' },
        render(lang) {
            return lang === 'he' ? `
                <p><b>למה זה כאן:</b> כמה טוב השחקן צריך לשחק כדי לנצח? החלק הזה לוקח את כל משחקיו המדורגים, בכל הליגות, ושואל איך <b>הפרש ה-PR</b> באותו משחק התחלק בין המשחקים שניצח לבין אלה שהפסיד.</p>
                <h4>רקע</h4>
                <p>PR (Performance Rating) מודד את איכות המהלכים במשחק &mdash; <b>נמוך יותר = טוב יותר</b>. לכל משחק יש סיכוי ניצחון צפוי לשחקן החזק יותר, הנקבע לפי הפרש ה-PR בין השניים ואורך המשחק. זהו מודל קבוע ומפורסם, שאינו מותאם לתוצאות הליגות שלנו.</p>
                ${prTableSection('he')}
                <h4>החישוב</h4>
                <p>לכל משחק ששוחק מחושב <b>הפרש PR</b> מנקודת מבטו של השחקן:</p>
                <p style="text-align:center"><i>הפרש</i> = <i>PR</i><sub>יריב</sub> &minus; <i>PR</i><sub>שחקן</sub></p>
                <p>הפרש <b>חיובי</b> אומר שהשחקן שיחק את המשחק ברמה טובה יותר מיריבו; הפרש <b>שלילי</b> אומר שהיריב שיחק טוב ממנו. המשחקים מקובצים ל-bins ברוחב נקודת PR אחת, וגובה כל עמודה הוא חלקם (%) מכלל המשחקים של סוג הליגה הנבחר.</p>
                <p>משחקים בעלי תוצאה טכנית, וכן משחקים ללא רישום PR, אינם נכללים.</p>
                <h4>איך קוראים את הגרף</h4>
                <p>ה-<b>Legend</b> קובע אילו סדרות מוצגות, וניתן להדליק ולכבות כל אחת:</p>
                <ul>
                    <li><span style="color:var(--color-win)"><b>Wins</b></span> &mdash; רק המשחקים שהשחקן ניצח.</li>
                    <li><span style="color:var(--color-loss)"><b>Losses</b></span> &mdash; רק המשחקים שהפסיד.</li>
                    <li><b>All</b> &mdash; כל המשחקים יחד, ללא קשר לתוצאה: זו התפלגות הפרשי ה-PR כשלעצמה.</li>
                </ul>
                <p>סדרה אחת מצוירת כ<b>עמודות</b>. מרגע שמוצגות שתיים או יותר, הן עוברות ל<b>קווים רציפים</b> &mdash; קו לכל סדרה, בצבע הסדרה, העובר דרך הערך של כל bin.</p>
                <h4>דוגמה</h4>
                <p>נניח ששחקן ניצח משחק שבו ה-PR שלו היה 4.5 וה-PR של יריבו 7.0. ההפרש הוא <span dir="ltr">7.0 &minus; 4.5 = +2.5</span>, ולכן המשחק נופל ב-bin <span dir="ltr">[2, 3)</span> של סדרת ה-<b>Wins</b>. אותו שחקן הפסיד משחק שבו שיחק 5.0 מול 8.0 של היריב: ההפרש הוא <span dir="ltr">+3.0</span> &mdash; הוא שיחק טוב יותר ובכל זאת הפסיד &mdash; ולכן המשחק נופל ב-bin <span dir="ltr">[3, 4)</span> של סדרת ה-<b>Losses</b>. אצל שחקן שתוצאות משחקיו תואמות לאיכות המשחק, עקומת ה-Wins יושבת ימינה מעקומת ה-Losses; ככל ששתי העקומות חופפות יותר, כך התוצאות היו פחות תלויות בהפרש ה-PR.</p>
                ${prGapExampleHistogramSvg('he')}
                <h4>הבקרות</h4>
                <ul>
                    <li><b>Gaussian fit</b> מציג לכל סדרה מוצגת עקומה נורמלית שהותאמה לממוצע ולסטיית התקן של אותה סדרה (&mu; ו-&sigma;),בתוספת קווים מקווקווים בממוצע ובמרחק &plusmn;1 סטיית תקן. כשמוצגת <b>סדרה אחת</b>, העקומה מצוירת <i>מעל</i> העמודות בכתום, כך שהמודל והנתונים נשארים מובחנים. כשמוצגות <b>כמה סדרות</b>, העקומות <i>מחליפות</i> את קווי הנתונים וכל אחת שומרת על צבע הסדרה שלה &mdash; אחרת היו בגרף שישה קווים כמעט מקבילים בשלושה צבעים. החלונית שנפתחת מציגה את קריאת ה-&mu;/&sigma; עבור כל שחקן מוצג בנפרד וברצף, באותו סדר שבו מופיעים הגרפים. זו הפניה חזותית בלבד &mdash; לא טענה שהפרשי ה-PR מתפלגים נורמלית. הכפתור מנוטרל כשאין מספיק משחקים כדי שממוצע/סטיית תקן יהיו משמעותיים.</li>
                    <li><b>Trim to 99%</b> מקרב את הציר לאמצע 99% ממשחקי השחקן ומסתיר את העמודות החריגות. שימושי כשקומץ משחקים קיצוניים מותח את הציר עד כדי כך שההתפלגות האמיתית נדחסת אל המרכז. לתצוגה בלבד &mdash; התאמת הגאוס וערכי ה-&mu;/&sigma; משתמשים תמיד בנתונים המלאים.</li>
                    <li>ה-<b>PILLS</b> שלמעלה מצמצמים את המשחקים לסוג ליגה אחד (${leagueTypePill('doubling')} / ${leagueTypePill('ubc')}), או מאחדים את כולם ב-<b>All</b>. ליגות ${leagueTypePill('regular')} אינן נכללות כלל &mdash; הן אינן רושמות PR.</li>
                    <li><b>+ Add player chart</b> מוסיף מתחת את ההתפלגות של שחקן נוסף, להשוואה.</li>
                    <li>כל הגרפים בערימה מצוירים על <b>אותה סקאלת X ואותה סקאלת Y</b>, עם אותן סדרות ואותה הגדרת התאמה &mdash; ולכן ה-Legend, ה-Gaussian fit וה-Trim יושבים פעם אחת מעל כולם ולא על כל גרף בנפרד. אם כל גרף היה מקבל סקאלה משל עצמו, התפלגות שטוחה והתפלגות מחודדת היו מצוירות באותו גובה, וההשוואה הייתה מטעה ולא מלמדת.</li>
                </ul>
            ` : `
                <p><b>Why it's here:</b> how well does this player have to play in order to win? This section takes every rated match they've played, across all leagues, and asks how the <b>PR gap</b> in each match splits between the ones they won and the ones they lost.</p>
                <h4>Background</h4>
                <p>PR (Performance Rating) measures the quality of the moves played in a match &mdash; <b>lower is better</b>. Every match has an expected win chance for the stronger player, set by the PR gap between the two and the match length. That's a fixed, published model, not fit to our leagues' own results.</p>
                ${prTableSection('en')}
                <h4>The calculation</h4>
                <p>For every played match a <b>PR gap</b> is computed from this player's point of view:</p>
                <p style="text-align:center"><i>gap</i> = <i>PR</i><sub>opponent</sub> &minus; <i>PR</i><sub>player</sub></p>
                <p>A <b>positive</b> gap means the player played that match at a higher level than their opponent; a <b>negative</b> gap means they were outplayed. Matches are grouped into 1-PR-point-wide bins, and each bar's height is the share (%) of all matches of the selected league type.</p>
                <p>Matches with a technical result, and matches with no PR recorded, are excluded.</p>
                <h4>Reading the graph</h4>
                <p>The <b>legend</b> controls which series are drawn, and each can be switched on and off:</p>
                <ul>
                    <li><span style="color:var(--color-win)"><b>Wins</b></span> &mdash; only the matches the player won.</li>
                    <li><span style="color:var(--color-loss)"><b>Losses</b></span> &mdash; only the matches they lost.</li>
                    <li><b>All</b> &mdash; every match together, regardless of result: the distribution of PR gaps in its own right.</li>
                </ul>
                <p>A single series is drawn as <b>bars</b>. As soon as two or more are shown they switch to <b>continuous lines</b> — one per series, in the series' colour, tracing each bin's value.</p>
                <h4>An example</h4>
                <p>Say the player wins a match where their PR was 4.5 and the opponent's was 7.0. The gap is <span dir="ltr">7.0 &minus; 4.5 = +2.5</span>, so that match lands in the <span dir="ltr">[2, 3)</span> bin of the <b>Wins</b> series. The same player loses a match where they played 5.0 against the opponent's 8.0: the gap is <span dir="ltr">+3.0</span> &mdash; they played better and still lost &mdash; so that match lands in the <span dir="ltr">[3, 4)</span> bin of the <b>Losses</b> series. For a player whose results follow how well they play, the Wins curve sits to the right of the Losses curve; the more the two overlap, the less the results tracked the PR gap.</p>
                ${prGapExampleHistogramSvg('en')}
                <h4>The controls</h4>
                <ul>
                    <li><b>Gaussian fit</b> draws, for each displayed series, a normal curve built from that series' own mean and standard deviation (&mu; and &sigma;), plus dashed lines at the mean and at &plusmn;1 standard deviation. With <b>one</b> series the curve is laid <i>over</i> the bars in orange, so model and data stay told apart. With <b>several</b>, the curves <i>replace</i> the data lines and each keeps its series' colour — otherwise the plot would carry six near-parallel strokes in three colours. The panel it opens gives the &mu;/&sigma; reading for every charted player in turn, in the same order as the charts. It's a visual reference only &mdash; not a claim that PR gaps are actually normally distributed. The button is disabled when there aren't enough matches for a mean/standard deviation to be meaningful.</li>
                    <li><b>Trim to 99%</b> zooms the X-axis in to the middle 99% of the player's matches, hiding the outlier bins. Worth reaching for when a handful of blow-out matches stretch the axis so wide that the real distribution is squeezed toward the centre. Display only &mdash; the Gaussian fit and the &mu;/&sigma; figures always use the full, untrimmed data.</li>
                    <li>The <b>pills</b> above narrow the matches to one league type (${leagueTypePill('doubling')} / ${leagueTypePill('ubc')}), or pool them all under <b>All</b>. ${leagueTypePill('regular')} leagues never appear &mdash; they record no PR.</li>
                    <li><b>+ Add player chart</b> stacks another player's distribution below, to compare against.</li>
                    <li>Every chart in the stack is drawn on the <b>same X and Y scale</b>, with the same series and the same fit setting &mdash; that's why the legend, Gaussian fit and Trim controls sit once above them all rather than on each chart. Left to self-scale, a flat distribution and a sharply peaked one would draw the same height and the comparison would mislead rather than inform.</li>
                </ul>
            `;
        },
    },

    // ============ 5c · Player Gaussian μ/σ explainer (player, dynamic) ============
    // Data-driven in the app: the live page calls playerGaussianSeriesHtml()
    // above — the SAME function this entry renders — once per displayed series,
    // with that series' real mean/std. Shown here for two sample series.
    {
        id: 'player-gaussian', page: 'player', dynamic: true,
        title: { en: 'What μ and σ mean (player Gaussian fit)', he: 'מה μ ו-σ אומרים (התאמת גאוס, עמוד שחקן)' },
        render(lang) {
            const sample = [
                { seriesLabel: 'Wins',   mean: 3.21, std: 5.80, games: 18 },
                { seriesLabel: 'Losses', mean: 0.10, std: 8.41, games: 12 },
            ];
            const note = lang === 'he'
                ? `<p class="popup-sample-note">חלונית מבוססת נתונים &mdash; מוצג בלוק אחד לכל סדרה מוצגת, עם הממוצע וסטיית התקן שלה, בצבע הסדרה. הדוגמה: שחקן בשם Moriarty עם הסדרות Wins ו-Losses.</p>`
                : `<p class="popup-sample-note">Data-driven popup &mdash; one block per displayed series, with that series' own mean and standard deviation, in the series' colour. Sample shown: a player named Moriarty with the Wins and Losses series.</p>`;
            return note + sample.map(s =>
                `<div class="pg-gauss-block">${playerGaussianSeriesHtml(lang, { displayName: 'Moriarty', ...s })}</div>`
            ).join('');
        },
    },

    // ============ 6 · Gaussian μ/σ explainer (dashboard, dynamic) ============
    // Data-driven in the app (buildGaussianExplainerHtml injects the row's real
    // mean/std). Shown here with sample values μ=2.14, σ=3.80 for reference.
    {
        id: 'gaussian', page: 'dashboard', dynamic: true,
        title: { en: 'What μ and σ mean (Gaussian fit)', he: 'מה μ ו-σ אומרים (התאמת גאוס)' },
        render(lang) {
            const mean = 2.14, std = 3.80, games = 240;
            const lo = minusFix((mean - std).toFixed(2)), hi = minusFix((mean + std).toFixed(2));
            const abs = Math.abs(mean).toFixed(2);
            const dirHe = mean >= 0 ? 'טוב יותר' : 'גרוע יותר';
            const dirEn = mean >= 0 ? 'better' : 'worse';
            return lang === 'he' ? `
                <p class="popup-sample-note">חלונית מבוססת נתונים — הערכים מחושבים חי לכל שורה. הדוגמה: μ=${mean.toFixed(2)}, σ=${std.toFixed(2)}.</p>
                <h4>מה בעצם &mu; ו-&sigma; אומרים?</h4>
                <p><b>&mu; (ממוצע) = <span dir="ltr">${minusFix(mean.toFixed(2))}</span></b>: בממוצע, על פני ${games} המשחקים, למנצח היה PR ${dirHe} בכ-${abs} נקודות מהמפסיד.</p>
                <p><b>&sigma; (סטיית תקן) = ${std.toFixed(2)}</b>: בכ-66.7% מ-${games} המשחקים פער ה-PR מצד המנצח היה בין <b><span dir="ltr">${lo}</span></b> ל-<b><span dir="ltr">${hi}</span></b>.</p>
            ` : `
                <p class="popup-sample-note">Data-driven popup — values are computed live per row. Sample shown: μ=${mean.toFixed(2)}, σ=${std.toFixed(2)}.</p>
                <h4>What do &mu; and &sigma; actually mean?</h4>
                <p><b>&mu; (mean) = ${minusFix(mean.toFixed(2))}</b>: on average, across the ${games} matches, the winner's PR was about ${abs} points ${dirEn} than the loser's.</p>
                <p><b>&sigma; (standard deviation) = ${std.toFixed(2)}</b>: in about 66.7% of those ${games} matches the winner-side PR gap was between <b>${lo}</b> and <b>${hi}</b>.</p>
            `;
        },
    },

    // ============ 7 · Table Validation (dashboard, dynamic) ============
    // The gap-by-gap table is computed from live match data
    // (buildExplanationTableHtml). Only the prose is stored here.
    {
        id: 'model-validation', page: 'dashboard', dynamic: true,
        title: { en: 'Table Validation', he: 'אימות טבלה' },
        render(lang) {
            return lang === 'he' ? `
                <p class="popup-sample-note">חלונית מבוססת נתונים — טבלת ה-Likelihood פר-פער מחושבת חי מנתוני הליגות. כאן מוצג ההסבר בלבד.</p>
                <h4>אימות טבלה: האם הנתונים תואמים את הטבלה?</h4>
                <p><b>למה זה כאן:</b> ה-<i>PR Win-Probability Table</i> היא טבלה קבועה ומפורסמת שנותנת, לכל פער PR ואורך משחק, את הסיכוי שהמועדף ינצח — וכל העמוד הזה נשען עליה. אבל האם הטבלה הזו באמת נכונה עבור השחקנים שלנו? הבדיקה הזו מרכזת את כל משחקי ${leagueTypePill('doubling')} ששוחקו אי פעם (באותו אורך משחק) ושואלת, עבור כל פער PR, האם המועדף ניצח בתדירות שהטבלה חוזה.</p>
                ${tableValidationExampleHistogramSvg('he')}
                <p>לכל פער PR השוואת שיעור הניצחון האמיתי של המועדף מול הערך שבטבלה נקראת <b>Likelihood</b>, ומשמעותה — עד כמה סביר היה שתוצאת אותו פער תצא במקרה בלבד:</p>
                ${likelihoodLegendTable('he')}
            ` : `
                <p class="popup-sample-note">Data-driven popup — the per-gap Likelihood table is computed live from match data. Only the prose is shown here.</p>
                <h4>Table Validation: does the data match the table?</h4>
                <p><b>Why it's here:</b> the <i>PR Win-Probability Table</i> is a fixed, published table giving, for every PR gap and match length, the favourite's win chance — and this whole page leans on it. But is that table actually right for our players? This check pools every ${leagueTypePill('doubling')} match ever played (at this match length) and asks, for every PR gap, whether the favourite won as often as the table predicts.</p>
                ${tableValidationExampleHistogramSvg('en')}
                <p>For each PR gap, the comparison of the favourite's real win rate against the table's value is called <b>Likelihood</b>, and its meaning is — how likely it was that this gap's result came up by chance alone:</p>
                ${likelihoodLegendTable('en')}
            `;
        },
    },
];

export function getPopup(id) {
    return POPUPS.find(p => p.id === id);
}
