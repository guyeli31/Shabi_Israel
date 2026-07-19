/**
 * dashboardPage.js — League Dashboard (Phase F).
 * F1: summary cards (with leader flag)
 * F2: historical view — defaults to current state showing medal winners only
 * F3: rounds navigator — all matches incl. unplayed, with "played on" column
 * F4: player picker + interactive bar chart, with multi-chart compare
 * Plus: prev/next league navigation arrows in the header.
 */

import { loadLeagueParams, loadLeagueOrder, loadOverrides, loadAllLeagueParams, loadLeagueMatchesAll, loadMatchHistory, applyOverrides } from '../data/store.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { getMatchesAsOf, getUpdatePoints, mergeHistoryIntoMatches, matchKey } from '../compute/matchHistory.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, formatPercent, formatNumber, leagueTableUrl, playerLeagueUrl, leagueUrl, flagUrl, getFlagCode, thLabel } from '../utils/helpers.js';
import { exportWhatsAppTableImage, MAX_EXPORT_ROWS, leagueTypeLabel } from '../utils/exportTableImage.js';
import { colorForValue, colorForValueInverted, colorForConfidence } from '../compute/colorScale.js';
import { drawPlayerBarChart, computeNiceRange } from './playerBarChart.js';
import { drawCorrelationRow, drawHistogramRow, signedLuckScore, luckAssessment } from './prCorrelationChart.js';
import { renderBreadcrumbs } from './navigation.js';
import { predictChampionship, computeTopXPct, prProbabilityTableHtml, getWinProbability, nearestMatchLengthIdx } from '../compute/championshipPredictor.js';
import { batchLast300PRForSimulator, loadVisibleLeagues } from '../compute/crossLeague.js';
import { loadPlayersMetadata } from '../data/store.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { langFlagsHtml, wireLangPopup, wireDynamicLangPopup } from '../utils/popupLang.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { startSplash, endSplash } from '../utils/splash.js';
import { buildLeagueHeaderData, renderV16Header, formatLastUpdatedDate } from './leagueHeader.js';
import { mountAppTabs } from './appTabs.js';
import { TAB_ICONS } from './tabIcons.js';
import { wireSectionCollapse } from './sectionCollapse.js';
import { mountAccordionTabs } from './subTabs.js';
import { displayPlayerName } from '../utils/nameDisplay.js';
import { registerSearchAdapter } from './searchOverlay.js';
import { mountCombobox } from '../utils/combobox.js';

export async function renderDashboardPage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');
    if (!leagueId) {
        container.innerHTML = '<div class="error">No league specified.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading dashboard...</div>';

    startSplash();
    try {
        const [params, overrides, history, leagueOrder, playersMeta, matchesAllData] = await Promise.all([
            loadLeagueParams(leagueId),
            loadOverrides(leagueId),
            loadMatchHistory(leagueId),
            loadLeagueOrder().catch(() => []),
            loadPlayersMetadata(),
            loadLeagueMatchesAll(leagueId)
        ]);
        const lastModified = params.LastUpdated || null;

        // Per-type navigation requires params of all leagues
        const folderNamesAll = (leagueOrder || []).map(t => t.replace(' - ', ' '));
        let allParams = [];
        try {
            allParams = await loadAllLeagueParams(folderNamesAll);
        } catch { allParams = []; }

        const title = params.LeagueTitle || leagueId;
        document.title = `${title} — Dashboard`;

        // V16 hero banner header (production default for the dashboard).
        renderV16Header(
            document.getElementById('page-title'),
            buildLeagueHeaderData(params, lastModified),
        );

        // Breadcrumbs
        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title }
        ]);

        installLeagueNavArrows(leagueId, allParams, params.LeagueType || 'doubling');

        // Both with-unplayed and only-played variants, from the single all-rows query
        const allMatchesIncUnplayedRaw = matchesAllData.matches;
        const playedMatchesRaw = allMatchesIncUnplayedRaw
            .filter(m => m.played)
            .map(({ playerA, prA, luckA, scoreA, playerB, prB, luckB, scoreB }) => ({ playerA, prA, luckA, scoreA, playerB, prB, luckB, scoreB }));
        const allPlayersSet = matchesAllData.allPlayers;
        const roundCount = Math.max(1, ...allMatchesIncUnplayedRaw.map(m => m.round || 1));

        // Apply manual overrides (consistency with league table)
        const playedMatches = applyOverrides(playedMatchesRaw, overrides);
        const allMatchesIncUnplayed = applyOverridesToAll(allMatchesIncUnplayedRaw, overrides);

        const leagueConfig = getLeagueConfig(params);
        const liveMatches = mergeHistoryIntoMatches(playedMatches, history.matches);

        const ctx = {
            leagueId, params, leagueConfig, lastModified,
            allMatchesIncUnplayed, playedMatches, liveMatches, allPlayersSet,
            roundCount,
            history, playersMeta
        };

        // Summary cards live just under the header (outside the tabs), matching
        // the landing page's hero → info-cards → tabs composition.
        container.innerHTML = '';
        const cardsHost = document.createElement('div');
        cardsHost.className = 'dashboard-cards';
        cardsHost.id = 'dash-cards';
        container.appendChild(cardsHost);

        // Progressive-disclosure tabs (same chrome as HOME via mountAppTabs).
        const shell = mountAppTabs({
            tabs: [
                { id: 'standings', label: 'Standings',      icon: TAB_ICONS.standings },
                { id: 'matches',   label: 'Matches',        icon: TAB_ICONS.matches },
                { id: 'predictor', label: 'Predictor',      icon: TAB_ICONS.predictor },
                { id: 'insights',  label: 'Charts', icon: TAB_ICONS.insights }
            ],
            urlKey: 'tab',
            ariaLabel: 'Dashboard sections',
            shellClass: 'dash-tabs-shell',
            panelClass: 'dash-tab-panel'
        });
        container.appendChild(shell.root);

        // Each render fn still targets the same element IDs — they're now nested
        // inside the right tab panel rather than appended to #content directly.
        shell.panels.standings.innerHTML = standingsPanel();
        shell.panels.matches.innerHTML   = matchesPanel();
        shell.panels.predictor.innerHTML = predictorPanel();
        shell.panels.insights.innerHTML  = insightsPanel();

        renderSummaryCards(ctx);
        renderPrizes(ctx);
        renderHistorical(ctx);
        renderPredictor(ctx); // async — fills in after data loads
        renderWhatIfSimulator(ctx);
        renderRounds(ctx);
        renderRemainingMatches(ctx);
        renderPlayerSection(ctx);
        renderPrCorrelationSection(ctx);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load dashboard: ${err.message}</div>`;
        console.error(err);
    } finally {
        endSplash();
    }
}

/**
 * Apply overrides to the full match list (including unplayed).
 * Unlike applyOverrides(), 'not_played' marks a match as unplayed instead of removing it.
 */
function applyOverridesToAll(matches, overrides) {
    if (!overrides || overrides.length === 0) return matches;
    const result = [...matches];
    for (const o of overrides) {
        const key = [o.playerA, o.playerB].sort().join('|');
        const idx = result.findIndex(m => {
            const mKey = [m.playerA, m.playerB].sort().join('|');
            return mKey === key;
        });

        if (o.type === 'not_played') {
            if (idx !== -1) {
                result[idx] = {
                    ...result[idx],
                    played: false,
                    scoreA: null, scoreB: null,
                    prA: null, prB: null,
                    luckA: null, luckB: null,
                    _overridden: true
                };
            }
            continue;
        }

        let newMatch;
        if (o.type === 'result') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: o.scoreA, scoreB: o.scoreB,
                prA: o.prA, prB: o.prB,
                luckA: o.luckA, luckB: o.luckB,
                played: true, _overridden: true
            };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1,
                prA: null, prB: null,
                luckA: null, luckB: null,
                played: true, _overridden: true, _technical: true
            };
        } else if (o.type === 'technical_draw') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: null, prB: null,
                luckA: null, luckB: null,
                played: true, _overridden: true, _technical: true, _draw: true
            };
        }

        if (newMatch) {
            if (idx !== -1) {
                newMatch.round = result[idx].round;
                result[idx] = newMatch;
            } else {
                result.push(newMatch);
            }
        }
    }
    return result;
}

function installLeagueNavArrows(leagueId, allParams, currentType) {
    if (!allParams || allParams.length === 0) return;
    // Filter to same league type only — preserves chronological order from landing_settings.json
    const sameType = allParams.filter(({ params }) => (params.LeagueType || 'doubling') === currentType);
    const folders = sameType.map(({ id }) => id);
    const idx = folders.indexOf(leagueId);
    if (idx === -1) return;

    const header = document.querySelector('.page-header');
    if (!header || header.querySelector('.league-nav')) return;

    const prev = idx > 0 ? folders[idx - 1] : null;
    const next = idx < folders.length - 1 ? folders[idx + 1] : null;

    const nav = document.createElement('div');
    nav.className = 'league-nav';
    nav.innerHTML = `
        <a class="nav-arrow ${prev ? '' : 'disabled'}" ${prev ? `href="${leagueUrl(prev)}" title="Previous league: ${prev}"` : 'title="No previous league"'}>&lsaquo;</a>
        <a class="nav-arrow ${next ? '' : 'disabled'}" ${next ? `href="${leagueUrl(next)}" title="Next league: ${next}"` : 'title="No next league"'}>&rsaquo;</a>
    `;
    (header.querySelector('#page-title') || header.querySelector('h1')).insertAdjacentElement('afterend', nav);
}

function standingsPanel() {
    return `
        <section class="app-section app-section--card dash-section">
            <h2 class="app-section-h2">Table</h2>
            <div class="dash-controls">
                <button id="hist-prev" title="Previous snapshot">&lsaquo;</button>
                <select id="hist-date" title="Select snapshot date"></select>
                <button id="hist-next" title="Next snapshot">&rsaquo;</button>
                <a id="hist-to-full" class="open-full-btn" href="#" title="Open the full league table for the current state">Open full table &rsaquo;</a>
            </div>
            <div id="hist-table"></div>
        </section>

        <section class="app-section app-section--card dash-section" id="prizes-section" style="display:none">
            <h2 class="app-section-h2">Prizes &amp; Medals</h2>
            <div id="prizes-content"></div>
        </section>
    `;
}

// Real typeset math (MathML — native in every current browser, no library/
// font load) for the Luck formula line in the "?" popup, replacing the old
// plain-text ".corr-formula" line. The equation itself doesn't change
// between English/Hebrew — only the surrounding prose does — so it's built
// once and reused everywhere the formula appears.
const LUCK_FORMULA_MATHML = `
    <math xmlns="http://www.w3.org/1998/Math/MathML" display="block" dir="ltr">
        <mi>Luck</mi><mo>=</mo>
        <mfrac><mn>1</mn><mi>n</mi></mfrac>
        <munderover><mo>&#8721;</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>
        <msub><mi>r</mi><mi>i</mi></msub>
        <mo>&#8901;</mo>
        <mrow><mo>|</mo><msub><mi>r</mi><mi>i</mi></msub><mo>|</mo></mrow>
        <mo>,</mo><mtext>&#160;where&#160;</mtext>
        <msub><mi>r</mi><mi>i</mi></msub><mo>=</mo><msub><mi>outcome</mi><mi>i</mi></msub><mo>&#8722;</mo><msub><mi>p</mi><mi>i</mi></msub>
    </math>
`;

function predictorPanel() {
    return `
        <section class="app-section app-section--card dash-section" id="predictor-section">
            <h2 class="app-section-h2">Championship Predictor
                <span class="predictor-tooltip" id="predictor-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="predictor-info-popup" hidden>
                <button class="predictor-info-close" id="predictor-info-close">&times;</button>
                <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                <div class="popup-lang-en" data-lang="en">
                <h3>How It Works</h3>
                <p>The predictor plays out all the matches still left in the league <b>thousands of times over</b>, each time with slightly different results, and simply counts how often each player ends up on top. A player who wins the title in, say, 6 out of every 10 imagined seasons gets a <b>60%</b> chance. The more matches are still to be played, the more open the race.</p>

                <h4>How strong is each player?</h4>
                <p>A player's strength comes from their recent <b>PR</b> (lower is better). But nobody plays exactly the same every night, so in each imagined match a player performs a little above or below their usual level. That built-in variation is what keeps upsets possible — a favourite can have an off night, and an underdog can shine.</p>

                <h4>Who wins a single match?</h4>
                <p>Two things decide the winner's odds: <b>how big the PR gap is</b> between the players, and <b>how long the match is</b>. A bigger gap favours the stronger player, and longer matches give the favourite more room to pull ahead (luck evens out over more games). The <i>PR Win-Probability Table</i> below shows the stronger player's win chance (%):</p>
                ${prProbabilityTableHtml('en')}
                <p>In-between gaps are read smoothly off the table — a gap of 3.5 sits halfway between the “3” and “4” rows.</p>

                <h4>Breaking a tie</h4>
                <p>When players finish level on the league's main score, the tie is settled differently depending on the league:</p>
                <ul>
                    <li><b>Doubling &amp; UBC leagues:</b> the player with the better (lower) <b>average PR</b> across the season comes out ahead.</li>
                    <li><b>Regular leagues:</b> the tie is settled first by the <b>head-to-head</b> result between the tied players, then by overall <b>points difference</b>, and finally alphabetically.</li>
                </ul>

                <h4>Margin of Error</h4>
                <p>Because the result comes from random simulation, the leader's percentage carries a small uncertainty. The <b>± figure</b> shown is a 95% confidence range — run more simulations and it shrinks. It reflects the randomness of the simulation only.</p>
                </div>
                <div class="popup-lang-he" data-lang="he">
                <h3>איך זה עובד</h3>
                <p>מנוע החיזוי משחק את כל המשחקים שנותרו בליגה <b>אלפי פעמים</b>, כל פעם עם תוצאות מעט שונות, וסופר כמה פעמים כל שחקן מסיים ראשון. שחקן שזוכה באליפות ב-6 מתוך כל 10 עונות מדומות, למשל, מקבל סיכוי של <b>60%</b>. ככל שנותרו יותר משחקים, כך המרוץ פתוח יותר.</p>

                <h4>כמה חזק כל שחקן?</h4>
                <p>העוצמה של שחקן נגזרת מה-<b>PR</b> העדכני שלו (נמוך יותר = טוב יותר). אבל אף אחד לא משחק באותה רמה בכל ערב, אז בכל משחק מדומה שחקן מבצע קצת מעל או מתחת לרמתו הרגילה. השונות הזו היא מה שמאפשר הפתעות — למועדף יכול להיות ערב חלש, ולמנוצח יכולה להיות הצגה טובה.</p>

                <h4>מי מנצח במשחק בודד?</h4>
                <p>שני דברים קובעים את הסיכויים: <b>גודל הפער ב-PR</b> בין השחקנים, ו<b>אורך המשחק</b>. פער גדול יותר מטה את הסיכויים לטובת השחקן החזק, ומשחקים ארוכים יותר נותנים למועדף יותר מקום להתרחק (המזל מתאזן על פני יותר משחקים). <i>טבלת סיכויי הניצחון לפי PR</i> שלמטה מציגה את סיכויי הניצחון (%) של השחקן החזק יותר:</p>
                ${prProbabilityTableHtml('he')}
                <p>פערים שבין הערכים בטבלה נקראים באופן חלק — פער של 3.5 יושב בדיוק באמצע שבין השורות "3" ו-"4".</p>

                <h4>שבירת שוויון</h4>
                <p>כששחקנים מסיימים שווים בניקוד הראשי של הליגה, השוויון נשבר בצורה שונה בהתאם לסוג הליגה:</p>
                <ul>
                    <li><b>ליגות דאבלינג ו-UBC:</b> השחקן עם ה-<b>PR הממוצע</b> הטוב יותר (נמוך יותר) לאורך העונה מדורג גבוה יותר.</li>
                    <li><b>ליגות רגילות:</b> השוויון נשבר קודם לפי התוצאה ה<b>ישירה</b> בין השחקנים המעורבים, אחר כך לפי <b>הפרש הנקודות</b> הכולל, ולבסוף לפי סדר אלפביתי.</li>
                </ul>

                <h4>טווח טעות</h4>
                <p>מכיוון שהתוצאה מבוססת על סימולציה אקראית, האחוז המוצג של המוביל נושא אי-ודאות קטנה. ה<b>± המוצג</b> הוא טווח ביטחון של 95% — ריצת סימולציות נוספות מצמצמת אותו. הוא משקף רק את האקראיות של הסימולציה עצמה.</p>
                </div>
            </div>
            <div class="predictor-moe" id="predictor-moe"></div>
            <div class="predictor-topx-control" id="predictor-topx-wrap" style="display:none">
                <label for="predictor-topx-input">Show</label>
                <select id="predictor-topx-input" class="topx-select"></select>
            </div>
            <div id="predictor-table"><div class="loading">Computing predictions...</div></div>
            <button id="predictor-expand" class="predictor-expand-btn" style="display:none">Show Full Table</button>
        </section>

        <section class="app-section app-section--card dash-section" id="whatif-section">
            <h2 class="app-section-h2">What If
                <span class="predictor-tooltip" id="whatif-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="whatif-info-popup" hidden>
                    <button class="predictor-info-close" id="whatif-info-close">&times;</button>
                    <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                    <div class="popup-lang-en" data-lang="en">
                    <h4>What If</h4>
                    <p>Pick any scheduled match in the league and force its outcome (A wins, B wins, or Not Played). Add as many matches as you like, then <b>Run Simulation</b> to see how the championship odds would change in that alternate scenario.</p>
                    <ul>
                        <li>Already-played matches load with their real result and can be overridden.</li>
                        <li>Unplayed matches start as <i>Not Played</i> — pick a winner to lock the outcome.</li>
                        <li>Player B's search narrows to players who share a scheduled match with Player A.</li>
                    </ul>
                    <p>The engine is the same as the real predictor above — only the inputs differ. Results are speculative and depend on your choices.</p>
                    </div>
                    <div class="popup-lang-he" data-lang="he">
                    <h4>מה אם</h4>
                    <p>בחרו כל משחק מתוזמן בליגה וכפו עליו תוצאה (A מנצח, B מנצח, או לא שוחק). ניתן להוסיף כמה משחקים שרוצים, ואז ללחוץ <b>הרץ סימולציה</b> כדי לראות איך סיכויי האליפות היו משתנים בתרחיש החלופי הזה.</p>
                    <ul>
                        <li>משחקים ששוחקו כבר נטענים עם התוצאה האמיתית שלהם וניתן לדרוס אותה.</li>
                        <li>משחקים שלא שוחקו מתחילים כ<i>לא שוחק</i> — בחרו מנצח כדי לקבוע את התוצאה.</li>
                        <li>החיפוש של שחקן B מצטמצם לשחקנים שיש להם משחק מתוזמן משותף עם שחקן A.</li>
                    </ul>
                    <p>מנוע החישוב זהה למנוע החיזוי האמיתי שלמעלה — רק הקלט שונה. התוצאות ספקולטיביות ותלויות בבחירות שלכם.</p>
                    </div>
                </div>
                <div id="whatif-body">
                    <div class="whatif-picker">
                        <div class="whatif-combo">
                            <input type="text" id="whatif-input-a" class="whatif-input app-search-input" placeholder="Player A" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="whatif-opts-a">
                            <ul id="whatif-opts-a" class="whatif-options" role="listbox" hidden></ul>
                        </div>
                        <span class="whatif-vs">vs</span>
                        <div class="whatif-combo">
                            <input type="text" id="whatif-input-b" class="whatif-input app-search-input" placeholder="Player B" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="whatif-opts-b">
                            <ul id="whatif-opts-b" class="whatif-options" role="listbox" hidden></ul>
                        </div>
                        <button id="whatif-add" class="whatif-add-btn" type="button">+ Add match</button>
                        <span id="whatif-add-err" class="whatif-err"></span>
                    </div>
                    <div id="whatif-staged" class="whatif-staged"></div>
                    <div class="whatif-actions">
                        <button id="whatif-run" class="whatif-run-btn" type="button">Run Simulation</button>
                        <button id="whatif-clear" class="whatif-clear-btn" type="button">Clear all</button>
                    </div>
                    <div id="whatif-output" class="whatif-output" hidden>
                        <div class="whatif-ribbon">SIMULATION &mdash; based on your what-if scenario</div>
                        <div class="whatif-moe" id="whatif-moe"></div>
                        <div class="predictor-topx-control" id="whatif-topx-wrap" style="display:none">
                            <label for="whatif-topx-input">Show</label>
                            <select id="whatif-topx-input" class="topx-select"></select>
                        </div>
                        <div id="whatif-table"></div>
                        <button id="whatif-expand" class="whatif-expand-btn" style="display:none">Show Full Table</button>
                    </div>
                </div>
        </section>
    `;
}

function matchesPanel() {
    return `
        <section class="app-section app-section--card dash-section">
            <h2 class="app-section-h2">Rounds</h2>
            <div class="dash-controls">
                <button id="round-prev" title="Previous round">&lsaquo;</button>
                <span class="round-label" id="round-label">Round 1 / 1</span>
                <button id="round-next" title="Next round">&rsaquo;</button>
                <button id="round-all" title="Show all rounds">All</button>
            </div>
            <div id="round-table"></div>
        </section>

        <section class="app-section app-section--card dash-section" id="remaining-section">
            <h2 class="app-section-h2">
                Remaining Matches
                <span id="remaining-count" style="font-size:0.8em;color:var(--color-text-muted);font-weight:normal"></span>
            </h2>
            <div id="rem-tab-bar"></div>
            <div id="rem-panel-b6a" class="subtab-panel" hidden></div>
            <div id="rem-panel-b6b" class="subtab-panel" hidden></div>
            <div id="rem-panel-b6c" class="subtab-panel" hidden></div>
        </section>
    `;
}

function insightsPanel() {
    return `
        <section class="app-section app-section--card dash-section">
            <h2 class="app-section-h2">Player match history</h2>
            <div id="charts-container"></div>
            <button id="add-chart" class="add-chart-btn" title="Add another chart for comparison">+ Add chart</button>
        </section>

        <section class="app-section app-section--card dash-section" id="pr-corr-section">
            <h2 class="app-section-h2">Player PR &harr; Result Correlation
                <span class="predictor-tooltip" id="pr-corr-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="pr-corr-info-popup" hidden>
                <button class="predictor-info-close" id="pr-corr-info-close">&times;</button>
                <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                <div class="popup-lang-en" data-lang="en">
                <h4>Background</h4>
                <p>Every match has an expected win chance for the stronger player, determined by two inputs:
                the <b>PR gap</b> between the two players, and the match length. This is a fixed, published
                model (not fit to this league's own results) &mdash; the same table is used to grade every
                match on this page, regardless of who played it or when.</p>

                <h4>The PR Win-Probability Table</h4>
                <p>Rows are PR gap, columns are match length; each cell is the stronger player's win chance
                (%) at that combination. In-between gaps are read by linear interpolation &mdash; a gap of 3.5
                sits exactly halfway between the "3" and "4" rows.</p>
                ${prProbabilityTableHtml('en')}

                <h4>Reading the graph</h4>
                <p>Each player has their own row of dots, one per match, placed by that player's <b>PR
                advantage</b> in the match &mdash; the opponent's PR minus their own (a lower PR means fewer
                mistakes, so a positive advantage means the player themselves played the better game). A dot
                further <b>right</b> means the player outplayed their opponent that match; further <b>left</b>
                means they were outplayed. <span style="color:var(--color-win)">Green</span> = win,
                <span style="color:var(--color-loss)">red</span> = loss. All player rows share one axis, sized
                to the widest PR gap seen between any two players (plus a little padding), so every player's
                row can be compared directly against every other.</p>

                <h4>The Luck score</h4>
                <p>Each player is assigned a signed <b>Luck</b> score, bounded in <code>[&minus;1, +1]</code>.
                A win always contributes a non-negative term (larger the bigger the underdog the player was);
                a loss always contributes a non-positive term (larger in magnitude the bigger the favourite
                the player was and still lost). Averaged over all of the player's matches:</p>
                <div class="corr-formula">${LUCK_FORMULA_MATHML}</div>
                <p>where <i>n</i> is the number of matches the player has on record, <i>p<sub>i</sub></i> is
                the win chance from the <i>PR Win-Probability Table</i> for match <i>i</i> (evaluated from
                this player's own side), and <i>outcome<sub>i</sub></i> is 1 if the player won that match, 0 if
                they lost. <i>r<sub>i</sub></i> is thus positive on a win and negative on a loss, and
                <i>r<sub>i</sub>&middot;|r<sub>i</sub>|</i> keeps that sign while still growing with the size of
                the surprise, the same way squaring would.</p>
                <div class="brier-scale">
                    <div class="brier-scale-bar"></div>
                    <div class="brier-scale-ticks">
                        <span class="brier-scale-tick" style="left:0%"><b>&minus;1</b><small>Extremely unlucky</small></span>
                        <span class="brier-scale-tick" style="left:50%"><b>0</b><small>Balanced</small></span>
                        <span class="brier-scale-tick" style="left:100%"><b>+1</b><small>Extremely lucky</small></span>
                    </div>
                </div>
                <table class="corr-band-table">
                    <tr><th>|Luck|</th><th>Label</th></tr>
                    <tr><td>0.00 &ndash; 0.05</td><td>Balanced</td></tr>
                    <tr><td>0.05 &ndash; 0.15</td><td>Slightly lucky / unlucky</td></tr>
                    <tr><td>0.15 &ndash; 0.30</td><td>Lucky / Unlucky</td></tr>
                    <tr><td>0.30 &ndash; 0.55</td><td>Very lucky / unlucky</td></tr>
                    <tr><td>0.55 &ndash; 1.00</td><td>Extremely lucky / unlucky</td></tr>
                </table>
                <p>The sign gives the direction: <b>+1</b> means the player was always the underdog and always
                won; <b>&minus;1</b> means they were always the favourite and still lost every time;
                <b>0</b> means results matched the model's expectations exactly, on average. It's shown from a
                player's very first match, even for someone who's won or lost every game so far &mdash;
                though like any average, it's noisier with only a handful of games.</p>
                </div>
                <div class="popup-lang-he" data-lang="he">
                <h4>רקע</h4>
                <p>לכל משחק יש סיכוי ניצחון צפוי לשחקן החזק יותר, הנקבע על ידי שני משתנים:
                <b>הפרש ה-PR</b> בין שני השחקנים, ואורך המשחק. זהו מודל קבוע ומפורסם (שאינו מותאם
                לתוצאות הליגה הזו עצמה) &mdash; אותה טבלה משמשת לדירוג כל משחק בעמוד הזה, ללא תלות
                במי שיחק אותו או מתי.</p>

                <h4>טבלת סיכויי הניצחון לפי PR</h4>
                <p>השורות הן הפרש ה-PR, העמודות הן אורך המשחק; כל תא הוא סיכוי הניצחון (%) של השחקן
                החזק יותר בשילוב הזה. פערים שביניים נקראים באמצעות אינטרפולציה לינארית &mdash; פער של
                3.5 יושב בדיוק באמצע שבין השורות "3" ו-"4".</p>
                ${prProbabilityTableHtml('he')}

                <h4>איך קוראים את הגרף</h4>
                <p>לכל שחקן יש שורת נקודות משלו, אחת לכל משחק, ממוקמת לפי <b>יתרון ה-PR</b>
                שלו באותו משחק — ה-PR של היריב פחות שלו (PR נמוך יותר = פחות טעויות, כך שיתרון
                חיובי אומר שהשחקן עצמו שיחק את המשחק הטוב יותר). נקודה שנמצאת יותר <b>ימינה</b> אומרת
                שהשחקן שיחק טוב מהיריב באותו משחק; יותר <b>שמאלה</b> אומרת שהיריב שיחק טוב ממנו.
                <span style="color:var(--color-win)">ירוק</span> = ניצחון,
                <span style="color:var(--color-loss)">אדום</span> = הפסד. כל שורות השחקנים חולקות ציר
                אחד, בגודל שמתאים לפער ה-PR הרחב ביותר שנצפה בין כל שני שחקנים (בתוספת ריווח קטן), כך
                שניתן להשוות ישירות בין השורות של כל השחקנים.</p>

                <h4>ציון המזל</h4>
                <p>לכל שחקן מוקצה ציון <b>מזל</b> מסומן, חסום בטווח <code>[&minus;1, +1]</code>.
                ניצחון תמיד תורם איבר לא-שלילי (גדול יותר ככל שהשחקן היה נחות יותר); הפסד תמיד תורם
                איבר לא-חיובי (גדול בערכו המוחלט ככל שהשחקן היה מועדף יותר ובכל זאת הפסיד). בממוצע על
                פני כל משחקי השחקן:</p>
                <div class="corr-formula">${LUCK_FORMULA_MATHML}</div>
                <p>כאשר <i>n</i> הוא מספר המשחקים הרשומים לשחקן, <i>p<sub>i</sub></i> הוא סיכוי הניצחון
                מתוך <i>PR Win-Probability Table</i> עבור משחק <i>i</i> (מחושב מנקודת המבט של השחקן
                עצמו), ו-<i>outcome<sub>i</sub></i> הוא 1 אם השחקן ניצח באותו משחק, 0 אם הפסיד.
                לכן <i>r<sub>i</sub></i> חיובי בניצחון ושלילי בהפסד, ו-<i>r<sub>i</sub>&middot;|r<sub>i</sub>|</i>
                שומר על הסימן הזה תוך שהוא עדיין גדל עם גודל ההפתעה, באותו אופן שריבוע היה גדל.</p>
                <div class="brier-scale">
                    <div class="brier-scale-bar"></div>
                    <div class="brier-scale-ticks">
                        <span class="brier-scale-tick" style="left:0%"><b>&minus;1</b><small>ביש מזל בקיצוניות</small></span>
                        <span class="brier-scale-tick" style="left:50%"><b>0</b><small>מאוזן</small></span>
                        <span class="brier-scale-tick" style="left:100%"><b>+1</b><small>בר מזל בקיצוניות</small></span>
                    </div>
                </div>
                <table class="corr-band-table">
                    <tr><th>|מזל|</th><th>תיאור</th></tr>
                    <tr><td>0.00 &ndash; 0.05</td><td>מאוזן</td></tr>
                    <tr><td>0.05 &ndash; 0.15</td><td>בר מזל / ביש מזל במעט</td></tr>
                    <tr><td>0.15 &ndash; 0.30</td><td>בר מזל / ביש מזל</td></tr>
                    <tr><td>0.30 &ndash; 0.55</td><td>בר מזל / ביש מזל מאוד</td></tr>
                    <tr><td>0.55 &ndash; 1.00</td><td>בר מזל / ביש מזל בקיצוניות</td></tr>
                </table>
                <p>הסימן נותן את הכיוון: <b>+1</b> אומר שהשחקן היה תמיד הנחות ותמיד ניצח;
                <b>&minus;1</b> אומר שהשחקן היה תמיד המועדף ובכל זאת הפסיד בכל פעם;
                <b>0</b> אומר שהתוצאות תאמו בדיוק את ציפיות המודל, בממוצע. הציון מוצג כבר מהמשחק
                הראשון של שחקן, גם אם ניצח או הפסיד בכל המשחקים עד כה &mdash; אך כמו כל ממוצע, הוא
                רועש יותר כשיש רק מעט משחקים.</p>
                </div>
            </div>
            <div id="corr-container"></div>
            <button id="add-corr-chart" class="add-chart-btn" title="Add another player's correlation row">+ Add player chart</button>
        </section>

        <section class="app-section app-section--card dash-section" id="league-corr-section">
            <h2 class="app-section-h2">League PR &harr; Result Correlation
                <span class="predictor-tooltip" id="league-corr-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="league-corr-info-popup" hidden>
                <button class="predictor-info-close" id="league-corr-info-close">&times;</button>
                <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                <div class="popup-lang-en" data-lang="en">
                <h4>Background</h4>
                <p>Every match has an expected win chance for the stronger player, determined by the
                <b>PR gap</b> between the two players and the match length &mdash; a fixed, published model,
                not fit to this league's own results. This section looks at that model in aggregate, across
                many matches at once, rather than one player at a time.</p>

                <h4>The PR Win-Probability Table</h4>
                <p>Rows are PR gap, columns are match length; each cell is the stronger player's win chance
                (%) at that combination.</p>
                ${prProbabilityTableHtml('en')}

                <h4>The calculation</h4>
                <p>For every match, an <b>advantage</b> value is computed:</p>
                <p style="text-align:center"><i>advantage</i> = <i>PR</i><sub>loser</sub> &minus;
                <i>PR</i><sub>winner</sub></p>
                <p>A positive advantage means the winner also had the better (lower) PR that match &mdash; the
                favourite won, as the table would predict. A negative advantage means an upset: the winner had
                the worse PR. Matches are then grouped into 1-PR-point-wide bins by their advantage value, and
                each bin's height is the share (%) of all matches falling in it.</p>
                <p><b>League &mdash; all matches</b> pools every match played in this league. <b>All League
                Matches</b> pools every match ever played in every league of the <i>same league type and the
                same match length</i> (a given PR gap matters more over a longer match, so mixing match
                lengths would blur the comparison). Matches with a technical result carry no real PR and are
                excluded from both rows.</p>

                <h4>Reading the graph</h4>
                <p>Both rows share one axis, sized to the widest advantage seen in the league (or across
                all-time history, once that loads) &mdash; independent of the player rows' axis further up the
                page.</p>

                <h4>The controls</h4>
                <ul>
                    <li><b>PR-gap shift</b> (all-time row only) adds a constant to every match's advantage
                    before the histogram, Gaussian fit, and Model validation table below are recomputed &mdash;
                    a way to test whether the model's calibration point is off by a fixed amount.</li>
                    <li><b>Trim to 99%</b> zooms a row's own view in to the middle 99% of its matches, hiding
                    the outlier bins &mdash; display only, the underlying data is unaffected.</li>
                    <li><b>Gaussian fit</b> overlays a normal curve fitted to that row's own mean and standard
                    deviation (shown as &mu; and &sigma;), plus dashed lines at the mean and at &plusmn;1
                    standard deviation &mdash; a visual reference only, not a claim that advantage values are
                    actually normally distributed. Disabled when a row doesn't have enough matches yet for a
                    mean/standard deviation to be meaningful.</li>
                    <li><b>Model validation</b> (all-time row only) checks, gap by gap, how often the
                    favourite actually won against what the <i>PR Win-Probability Table</i> predicts, with a
                    likelihood read on how surprising each gap's result is.</li>
                </ul>
                </div>
                <div class="popup-lang-he" data-lang="he">
                <h4>רקע</h4>
                <p>לכל משחק יש סיכוי ניצחון צפוי לשחקן החזק יותר, הנקבע לפי <b>הפרש ה-PR</b> בין שני
                השחקנים ואורך המשחק &mdash; מודל קבוע ומפורסם, שאינו מותאם לתוצאות הליגה הזו עצמה.
                הסקשן הזה בוחן את המודל הזה באופן מצרפי, על פני הרבה משחקים בבת אחת, ולא שחקן אחד
                בכל פעם.</p>

                <h4>טבלת סיכויי הניצחון לפי PR</h4>
                <p>השורות הן הפרש ה-PR, העמודות הן אורך המשחק; כל תא הוא סיכוי הניצחון (%) של השחקן
                החזק יותר בשילוב הזה.</p>
                ${prProbabilityTableHtml('he')}

                <h4>החישוב</h4>
                <p>עבור כל משחק, מחושב ערך <b>יתרון</b>:</p>
                <p style="text-align:center"><i>יתרון</i> = <i>PR</i><sub>מפסיד</sub> &minus;
                <i>PR</i><sub>מנצח</sub></p>
                <p>יתרון חיובי אומר שלמנצח היה גם ה-PR הטוב יותר (הנמוך יותר) באותו משחק &mdash; המועדף
                ניצח, כפי שהטבלה הייתה חוזה. יתרון שלילי אומר שהייתה הפתעה: למנצח היה ה-PR הגרוע יותר.
                המשחקים מקובצים לאחר מכן ל-bins ברוחב נקודת PR אחת לפי ערך היתרון שלהם, וגובה כל bin
                הוא חלקם (%) של כלל המשחקים שנופלים בו.</p>
                <p><b>הליגה &mdash; כל המשחקים</b> מרכזת את כל המשחקים ששוחקו בליגה הזו. <b>כל משחקי
                הליגות</b> מרכזת את כל המשחקים ששוחקו אי פעם בכל הליגות מ<i>אותו סוג ליגה ואותו אורך
                משחק</i> (פער PR נתון משמעותי יותר במשחק ארוך יותר, כך שערבוב אורכי משחק שונים היה
                מטשטש את ההשוואה). למשחקים עם תוצאה טכנית אין PR אמיתי, והם אינם נכללים באף אחת
                מהשורות.</p>

                <h4>איך קוראים את הגרף</h4>
                <p>שתי השורות חולקות ציר אחד, בגודל שמתאים ליתרון הרחב ביותר שנצפה בליגה (או בהיסטוריה
                של כל הליגות, לאחר שהיא נטענת) &mdash; בלתי תלוי בציר של שורות השחקנים שלמעלה בעמוד.</p>

                <h4>הבקרות</h4>
                <ul>
                    <li><b>הזזת פער PR</b> (בשורת "כל הליגות" בלבד) מוסיפה קבוע ליתרון של כל משחק לפני
                    שההיסטוגרמה, התאמת הגאוס וטבלת אימות המודל למטה מחושבות מחדש &mdash; דרך לבדוק האם
                    נקודת הכיול של המודל מוזזת בכמות קבועה.</li>
                    <li><b>חתוך ל-99%</b> מקרב את התצוגה של השורה לאמצע 99% מהמשחקים שלה, ומסתיר
                    את העמודות החריגות &mdash; לתצוגה בלבד, הנתונים עצמם אינם מושפעים.</li>
                    <li><b>התאמת גאוס</b> מציגה עקומה נורמלית שמותאמת לממוצע ולסטיית התקן של אותה שורה
                    (מוצגים כ-&mu; ו-&sigma;), בתוספת קווים מקווקווים בממוצע ובמרחק &plusmn;1
                    סטיית תקן &mdash; הפניה חזותית בלבד, לא טענה שערכי היתרון אכן מתפלגים נורמלית.
                    מנוטרל כשלשורה אין עדיין מספיק משחקים שממוצע/סטיית תקן יהיו משמעותיים.</li>
                    <li><b>אימות מודל</b> (בשורת "כל הליגות" בלבד) בודק, פער אחר פער, כמה פעמים המועדף
                    ניצח בפועל לעומת מה ש<i>PR Win-Probability Table</i> חוזה, עם קריאת סבירות לכך עד
                    כמה תוצאת כל פער מפתיעה.</li>
                </ul>
                </div>
            </div>
            <div id="corr-league-container">
        </section>
    `;
}

// ---------- F1 ----------
function renderSummaryCards(ctx) {
    const { params, liveMatches, allPlayersSet, leagueConfig } = ctx;
    const statsMap = computeAllStats(liveMatches, allPlayersSet);
    const rankings = buildRankings(statsMap, leagueConfig, liveMatches);
    const averages = computeAverages(rankings, leagueConfig);
    const matchStats = computeMatchStats(rankings, allPlayersSet.size);

    const leader = rankings.find(r => r.games > 0);
    let leaderHtml = 'N/A';
    if (leader) {
        const flagCode = getFlagCode(leader.player, params.CustomFlags);
        const leaderHidden = !!(ctx.playersMeta[leader.player] && ctx.playersMeta[leader.player].hidden);
        leaderHtml = `${leaderHidden ? '' : `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}" style="vertical-align:middle">`} ${playerNameLink(leader.player, ctx.playersMeta[leader.player])}`;
    }
    const avgPR = averages && averages.meanPR != null ? formatNumber(averages.meanPR) : 'N/A';
    const cards = [
        { label: 'Games Played', value: `${matchStats.playedMatches} / ${matchStats.totalMatches}` }
    ];
    if (leagueConfig.showPR) cards.push({ label: 'Average PR', value: avgPR });
    cards.push({ label: 'Leading Player', value: leaderHtml, flex: true });

    const cardsHost = document.getElementById('dash-cards');
    cardsHost.innerHTML = cards.map(c => `
        <div class="dash-card${c.flex ? ' dash-card--flex' : ''}">
            <div class="dash-card-label">${c.label}</div>
            <div class="dash-card-value">${c.value}</div>
        </div>
    `).join('');
    attachPlayerNameInteractions(cardsHost, ctx.leagueId);
}

// Measures the rendered width of sticky col-1 and writes --col1-w on the wrapper
// so sticky col-2's left: var(--col1-w) aligns correctly (iron rule 12).
function measureScrollWrapStickyCols(wrap) {
    if (!wrap) return;
    const th1 = wrap.querySelector('thead th:nth-child(1)');
    if (!th1) return;
    const write = () => {
        const w = th1.getBoundingClientRect().width;
        if (w > 0) wrap.style.setProperty('--col1-w', w + 'px');
    };
    write();
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(write).observe(wrap);
    }
}

// ---------- Prizes ----------
function renderPrizes(ctx) {
    const { params } = ctx;
    const prizes = params.Prizes;
    if (!prizes) return;

    const section = document.getElementById('prizes-section');
    const content = document.getElementById('prizes-content');
    section.style.display = '';

    const entryFee = params.EntryFee != null ? params.EntryFee : '—';
    const goldCount = params.GoldCount ?? 1;
    const silverCount = params.SilverCount ?? 1;
    const rows = [];
    if (goldCount) rows.push({ medal: '🥇', tier: 'Gold', count: goldCount, prize: prizes.Gold != null ? `₪${prizes.Gold.toLocaleString()}` : '—' });
    if (silverCount) rows.push({ medal: '🥈', tier: 'Silver', count: silverCount, prize: prizes.Silver != null ? `₪${prizes.Silver.toLocaleString()}` : '—' });
    if (params.BronzeCount) rows.push({ medal: '🥉', tier: 'Bronze', count: params.BronzeCount, prize: prizes.Bronze != null ? `₪${prizes.Bronze.toLocaleString()}` : '—' });

    let html = `<div class="prizes-info"><span class="prizes-entry">Entry Fee: <b>₪${entryFee}</b></span></div>`;
    html += '<div class="prizes-table-wrap"><table class="dash-table prizes-table font-small" data-mf-table-id="B1"><thead><tr><th scope="col"></th><th scope="col">Tier</th><th scope="col">Places</th><th scope="col">Prize</th></tr></thead><tbody>';
    for (const r of rows) {
        html += `<tr class="prize-row-${r.tier.toLowerCase()}"><td>${r.medal}</td><td>${r.tier}</td><td>${r.count}</td><td>${r.prize}</td></tr>`;
    }
    html += '</tbody></table></div>';
    content.innerHTML = html;

    // Prizes & Medals is collapsible, closed by default (shared section collapse).
    wireSectionCollapse(section, { defaultOpen: false });
}

// ---------- F2 ----------
function renderHistorical(ctx) {
    const { history, lastModified, leagueId } = ctx;
    const select = document.getElementById('hist-date');
    const prevBtn = document.getElementById('hist-prev');
    const nextBtn = document.getElementById('hist-next');
    const fullLink = document.getElementById('hist-to-full');

    const updatePoints = getUpdatePoints(history); // descending, date+time
    // Build options: "Current" first (always), then each historical update point
    const currentLabel = lastModified
        ? `Current (${formatLastModified(lastModified)})`
        : 'Current';
    const options = [{ value: '__current__', label: currentLabel }];
    for (const p of updatePoints) options.push({ value: p.value, label: p.label });

    select.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    // The "Open full table" button follows the selected snapshot: for Current it
    // opens the live league table; for a historical point it carries ?asof= so
    // table D rebuilds that snapshot, and its label flags the historical state.
    function syncFullLink() {
        const value = select.value;
        const label = options[select.selectedIndex] ? options[select.selectedIndex].label : '';
        if (value === '__current__') {
            fullLink.href = leagueTableUrl(leagueId);
            fullLink.textContent = 'Open full table ›';
            fullLink.title = 'Open the full league table for the current state';
        } else {
            fullLink.href = `${leagueTableUrl(leagueId)}&asof=${encodeURIComponent(value)}`;
            fullLink.textContent = 'Open full historical table ›';
            fullLink.title = `Open the full league table as of ${label} (historical version)`;
        }
    }

    function update() {
        const idx = select.selectedIndex;
        prevBtn.disabled = idx <= 0;
        nextBtn.disabled = idx >= options.length - 1;
        syncFullLink();
        drawHistTable(ctx, select.value);
    }

    select.addEventListener('change', update);
    prevBtn.addEventListener('click', () => {
        if (select.selectedIndex > 0) { select.selectedIndex--; update(); }
    });
    nextBtn.addEventListener('click', () => {
        if (select.selectedIndex < options.length - 1) { select.selectedIndex++; update(); }
    });

    update();
}

function formatLastModified(s) {
    const d = new Date(s);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function drawHistTable(ctx, dateValue) {
    const { history, allPlayersSet, leagueConfig, liveMatches, params } = ctx;

    let matchesForView;
    if (dateValue === '__current__') {
        matchesForView = liveMatches;
    } else {
        // dateValue is now an exact update-point timestamp (see getUpdatePoints)
        matchesForView = getMatchesAsOf(history, dateValue);
    }

    const statsMap = computeAllStats(matchesForView, allPlayersSet);
    const rankings = buildRankings(statsMap, leagueConfig, matchesForView);

    const goldCount = params.GoldCount || 1;
    const silverCount = params.SilverCount || 1;
    const bronzeCount = params.BronzeCount || 4;
    const medalLimit = goldCount + silverCount + bronzeCount;
    // B2 shows only the medal positions. A player who hasn't played yet as of
    // this snapshot must still appear if the league's ranking criteria place them
    // within the medals (their primary stat is null → sorted to the bottom, so in
    // practice this only happens very early on) — so we cap by rank but do NOT
    // drop games === 0. Only 'Bye' is excluded.
    const top = rankings.filter(r => r.rank <= medalLimit && r.player !== 'Bye');

    function rankClass(rank) {
        if (rank <= goldCount) return 'rank-gold';
        if (rank <= goldCount + silverCount) return 'rank-silver';
        if (rank <= medalLimit) return 'rank-bronze';
        return '';
    }

    let html = `<table class="dash-table font-large" data-mf-table-id="B2"><thead><tr><th scope="col">#</th><th scope="col" class="player-col">Player</th><th scope="col">MP</th><th scope="col">W</th><th scope="col">L</th>`;
    if (leagueConfig.showWinRate) html += `<th scope="col">Win%</th>`;
    if (leagueConfig.showPRWins) html += `<th scope="col">PRW</th><th scope="col">Avg PTS</th>`;
    if (leagueConfig.showPR) html += `<th scope="col">PR</th>`;
    html += '</tr></thead><tbody>';
    if (top.length === 0) {
        html += `<tr><td colspan="9" style="text-align:center;color:var(--color-text-muted)">No matches played yet</td></tr>`;
    }
    for (const r of top) {
        const flagCode = getFlagCode(r.player, params.CustomFlags);
        const rHidden = !!(ctx.playersMeta[r.player] && ctx.playersMeta[r.player].hidden);
        html += `<tr class="${rankClass(r.rank)}">
            <td data-label="Rank">${r.rank}</td>
            <td class="player-cell" data-label="Player">${rHidden ? '' : `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">`} ${playerNameLink(r.player, ctx.playersMeta[r.player])}</td>
            <td data-label="Games">${r.games}</td><td data-label="Wins">${r.wins}</td><td data-label="Losses">${r.losses}</td>`;
        if (leagueConfig.showWinRate) html += `<td data-label="Win Rate">${r.winRate != null ? formatPercent(r.winRate) : 'N/A'}</td>`;
        if (leagueConfig.showPRWins) html += `<td data-label="PR Wins">${r.prWins != null ? r.prWins : 'N/A'}</td><td data-label="Avg Points">${r.avgPoints != null ? formatNumber(r.avgPoints) : 'N/A'}</td>`;
        if (leagueConfig.showPR) html += `<td data-label="Mean PR">${r.meanPR != null ? formatNumber(r.meanPR) : 'N/A'}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    const host = document.getElementById('hist-table');
    host.innerHTML = `<div class="dash-table-wrap">${html}</div>`;
    attachPlayerNameInteractions(host, ctx.leagueId);
    measureScrollWrapStickyCols(host.querySelector('.dash-table-wrap'));
    attachStickyShadow(host.querySelector('.dash-table-wrap'));
}

// ---------- Championship Predictor ----------
function ensureLast300Map(ctx) {
    if (!ctx._last300MapPromise) {
        // Simulator pools all non-REGULAR leagues (doubling + ubc) into one
        // Last-300 window, regardless of this league's own type.
        ctx._last300MapPromise = batchLast300PRForSimulator([...ctx.allPlayersSet]);
    }
    return ctx._last300MapPromise;
}

async function renderPredictor(ctx) {
    const section = document.getElementById('predictor-section');
    const host = document.getElementById('predictor-table');
    const moeHost = document.getElementById('predictor-moe');
    const expandBtn = document.getElementById('predictor-expand');

    // Shown for finished leagues too — the remaining===0 branch below renders
    // the season-complete line instead of a live simulation.
    section.style.display = '';

    // Wire info popup toggle
    const infoBtn = document.getElementById('predictor-info-btn');
    const infoPopup = document.getElementById('predictor-info-popup');
    const infoClose = document.getElementById('predictor-info-close');
    wireLangPopup(section, { btn: infoBtn, popup: infoPopup, close: infoClose });
    wireSectionCollapse(section, { defaultOpen: true, infoBtn });

    // Find remaining (unplayed) matches
    const remaining = ctx.allMatchesIncUnplayed.filter(m => !m.played);

    if (remaining.length === 0) {
        // Season complete — show final standings
        const statsMap = computeAllStats(ctx.liveMatches, ctx.allPlayersSet);
        const rankings = buildRankings(statsMap, ctx.leagueConfig, ctx.liveMatches);
        const top = rankings[0];
        moeHost.textContent = '';
        host.innerHTML = `<div style="text-align:center;color:var(--color-text-muted);padding:var(--space-md)">Season complete — ${top ? top.player : 'N/A'} wins the championship.</div>`;
        return;
    }

    try {
        const statsMap = computeAllStats(ctx.liveMatches, ctx.allPlayersSet);
        const matchLength = ctx.params.MatchLength || 7;

        // Load Last 300 PR (async — may take a moment). Cached on ctx for reuse by the What-If simulator.
        const last300Map = await ensureLast300Map(ctx);

        const result = predictChampionship({
            statsMap,
            remainingMatches: remaining,
            matchLength,
            leagueConfig: ctx.leagueConfig,
            last300Map,
            allPlayers: ctx.allPlayersSet,
            playedMatches: ctx.liveMatches
        });

        // Render MoE
        if (result.method === 'montecarlo' && result.moe > 0) {
            moeHost.textContent = `Margin of Error: \u00b1${result.moe.toFixed(1)}% (95% confidence, ${result.iterations.toLocaleString()} simulations)`;
        } else {
            moeHost.textContent = `Exact calculation (${result.iterations.toLocaleString()} scenarios)`;
        }

        // Wire Top X control
        const topXWrap = document.getElementById('predictor-topx-wrap');
        const topXInput = document.getElementById('predictor-topx-input');
        topXWrap.style.display = '';
        topXInput.innerHTML = '';
        for (let x = 1; x <= result.n; x++) {
            const opt = document.createElement('option');
            opt.value = x;
            opt.textContent = x === 1 ? '1st place only' : x === result.n ? `Top ${x} (any finish)` : `Top ${x}`;
            topXInput.appendChild(opt);
        }
        topXInput.value = 1;
        let currentX = 1;

        const getTopXPct = (r) =>
            computeTopXPct(result.finishRankCounts, r.playerIdx, result.n, result.totalWeight, currentX);

        topXInput.addEventListener('change', () => {
            currentX = parseInt(topXInput.value);
            renderTable(expanded);
        });

        // Render table
        const showPR = ctx.leagueConfig.showPR;
        const showPRWins = ctx.leagueConfig.showPRWins;
        let expanded = false;
        const renderTable = (full) => {
            const sorted = [...result.rankings].sort((a, b) => getTopXPct(b) - getTopXPct(a));
            const data = full ? sorted : sorted.slice(0, 5);
            const rows = data.map((r, i) => {
                const flagCode = getFlagCode(r.player, ctx.params.CustomFlags);
                const pct = getTopXPct(r);
                const barColor = pct > Math.min(20 * currentX, 80) ? 'var(--tier-high)' : pct > Math.min(5 * currentX, 30) ? 'var(--tier-mid)' : 'var(--tier-low)';
                let ubcCols = '';
                if (showPRWins) {
                    ubcCols = `<td>${r.points}</td><td>${r.avgPoints != null ? formatNumber(r.avgPoints) : '—'}</td>`;
                }
                return `<tr>
                    <td>${i + 1}</td>
                    <td class="player-cell">${ctx.playersMeta[r.player]?.hidden ? '' : `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">`} ${playerNameLink(r.player, ctx.playersMeta[r.player])}</td>
                    <td>${r.games}</td>
                    <td>${r.wins}</td>
                    <td>${r.losses}</td>
                    ${ubcCols}
                    <td>${showPR ? (r.meanPR != null ? formatNumber(r.meanPR) : '—') : (r.winRate != null ? formatPercent(r.winRate) : '—')}</td>
                    <td class="predictor-pct-cell">
                        <div class="predictor-pct-bar" style="--pct:${Math.min(pct, 100)}%;--bar-color:${barColor}">
                            ${pct.toFixed(1)}%
                        </div>
                    </td>
                </tr>`;
            }).join('');

            const prHeader = showPR ? 'PR' : 'Win%';
            let ubcHeaders = '';
            if (showPRWins) {
                ubcHeaders = `<th scope="col">PTS</th><th scope="col">Avg PTS</th>`;
            }
            const pctShortHeader = currentX === 1 ? 'Ch%' : `T${currentX}%`;
            host.innerHTML = `
                <div class="predictor-scroll-wrap">
                <table class="dash-table font-small" data-mf-table-id="B3">
                    <thead><tr>
                        <th scope="col">#</th><th scope="col" class="player-col">Player</th><th scope="col">MP</th><th scope="col">W</th><th scope="col">L</th>
                        ${ubcHeaders}
                        <th scope="col">${prHeader}</th><th scope="col">${pctShortHeader}</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                </div>`;
            attachPlayerNameInteractions(host, ctx.leagueId);
            measureScrollWrapStickyCols(host.querySelector('.predictor-scroll-wrap'));
            attachStickyShadow(host.querySelector('.predictor-scroll-wrap'));
        };

        renderTable(false);

        // Show expand button if more than 5 players
        if (result.rankings.length > 5) {
            const total = result.rankings.length;
            expandBtn.style.display = '';
            expandBtn.textContent = `Show all (${total})`;
            expandBtn.onclick = () => {
                expanded = !expanded;
                renderTable(expanded);
                expandBtn.textContent = expanded ? 'Show top 5' : `Show all (${total})`;
            };
        }
    } catch (err) {
        host.innerHTML = `<div class="error">Prediction failed: ${err.message}</div>`;
        console.error('Championship predictor error:', err);
    }
}

// ---------- What-If Simulator ----------
function renderWhatIfSimulator(ctx) {
    const section = document.getElementById('whatif-section');
    if (!section) return;
    const infoBtn = document.getElementById('whatif-info-btn');
    const infoPopup = document.getElementById('whatif-info-popup');
    const infoClose = document.getElementById('whatif-info-close');
    const inputA = document.getElementById('whatif-input-a');
    const inputB = document.getElementById('whatif-input-b');
    const optsA = document.getElementById('whatif-opts-a');
    const optsB = document.getElementById('whatif-opts-b');
    const addBtn = document.getElementById('whatif-add');
    const addErr = document.getElementById('whatif-add-err');
    const stagedHost = document.getElementById('whatif-staged');
    const runBtn = document.getElementById('whatif-run');
    const clearBtn = document.getElementById('whatif-clear');
    const output = document.getElementById('whatif-output');
    const moeHost = document.getElementById('whatif-moe');
    const tableHost = document.getElementById('whatif-table');
    const expandBtn = document.getElementById('whatif-expand');

    // Collapse toggle (shared section header)
    wireSectionCollapse(section, { defaultOpen: true, infoBtn });

    // Info popup
    wireLangPopup(section, { btn: infoBtn, popup: infoPopup, close: infoClose });

    // Build schedule index: canonical key -> match record
    const scheduleByKey = new Map();
    const opponentsOf = new Map();
    for (const m of ctx.allMatchesIncUnplayed) {
        if (!m.playerA || !m.playerB) continue;
        const k = canonKey(m.playerA, m.playerB);
        if (!scheduleByKey.has(k)) scheduleByKey.set(k, m);
        if (!opponentsOf.has(m.playerA)) opponentsOf.set(m.playerA, new Set());
        if (!opponentsOf.has(m.playerB)) opponentsOf.set(m.playerB, new Set());
        opponentsOf.get(m.playerA).add(m.playerB);
        opponentsOf.get(m.playerB).add(m.playerA);
    }

    const allPlayersSorted = [...opponentsOf.keys()].filter(p => p !== 'Bye').sort();

    // Custom combobox: clicking shows all options; typing narrows the list.
    // Replaces native <datalist>, which behaves poorly/inconsistently on mobile.
    function attachCombo(input, dropdown, getOptions, onSelect) {
        let filtered = [];
        let activeIdx = -1;

        function highlight() {
            const items = dropdown.querySelectorAll('.whatif-option');
            items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
            if (activeIdx >= 0 && items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
        }

        function open() {
            const q = input.value.trim().toLowerCase();
            const all = getOptions();
            filtered = q ? all.filter(p => p.toLowerCase().includes(q)) : all.slice();
            activeIdx = -1;
            if (filtered.length === 0) { close(); return; }
            dropdown.innerHTML = filtered
                .map((p, i) => `<li class="whatif-option" role="option" data-idx="${i}">${escapeHtml(displayPlayerName(p))}</li>`)
                .join('');
            dropdown.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }

        function close() {
            dropdown.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            activeIdx = -1;
        }

        function choose(val) {
            input.value = val;
            close();
            if (onSelect) onSelect();
        }

        // Mobile search-sheet adapter: same option source as this combo, feeding
        // the 16px overlay. Picking runs the combo's own choose().
        registerSearchAdapter(input, {
            suggest(query) {
                const q = query.trim().toLowerCase();
                const all = getOptions();
                const pool = q ? all.filter(p => p.toLowerCase().includes(q)) : all;
                return pool.slice(0, 50).map(p => ({ label: displayPlayerName(p), key: p, value: p }));
            },
            pick(item) { choose(item.value); },
        });

        input.addEventListener('focus', open);
        input.addEventListener('click', open);
        input.addEventListener('input', open);

        input.addEventListener('keydown', (e) => {
            if (dropdown.hidden) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
                highlight();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIdx = Math.max(activeIdx - 1, 0);
                highlight();
            } else if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx]) {
                e.preventDefault();
                e.stopImmediatePropagation();
                choose(filtered[activeIdx]);
            } else if (e.key === 'Escape') {
                close();
            }
        });

        // mousedown (not click) so selection fires before the input's blur closes the list
        dropdown.addEventListener('mousedown', (e) => {
            const li = e.target.closest('.whatif-option');
            if (!li) return;
            e.preventDefault();
            choose(filtered[Number(li.dataset.idx)]);
        });

        input.addEventListener('blur', () => setTimeout(close, 150));

        return { close };
    }

    attachCombo(inputA, optsA, () => allPlayersSorted);
    attachCombo(inputB, optsB, () => {
        const a = inputA.value.trim();
        if (a && opponentsOf.has(a)) {
            return [...opponentsOf.get(a)].filter(p => p !== 'Bye' && p !== a).sort();
        }
        return allPlayersSorted;
    });

    // State: staged matches
    const staged = []; // { a, b, key, result: 'NP'|'A'|'B', realWinner: 'A'|'B'|null, wasPlayed: bool }

    // Persist the "Show" (Top X) selection across re-runs of the simulation
    let lastTopX = 1;

    function findSchedule(a, b) {
        return scheduleByKey.get(canonKey(a, b)) || null;
    }

    function realWinnerOf(m) {
        if (!m || !m.played) return null;
        if (m._draw) return null;
        if (m.scoreA > m.scoreB) return 'A_of_schedule';
        if (m.scoreB > m.scoreA) return 'B_of_schedule';
        return null;
    }

    function addMatch() {
        addErr.textContent = '';
        const a = inputA.value.trim();
        const b = inputB.value.trim();
        if (!a || !b) { addErr.textContent = 'Pick both players'; return; }
        if (a === b) { addErr.textContent = 'Cannot pair a player with themselves'; return; }
        if (!opponentsOf.has(a) || !opponentsOf.has(b)) { addErr.textContent = 'Unknown player'; return; }
        const sched = findSchedule(a, b);
        if (!sched) { addErr.textContent = 'No scheduled match between these players'; return; }
        const key = canonKey(a, b);
        if (staged.some(s => s.key === key)) { addErr.textContent = 'Match already added'; return; }

        // Determine real result relative to the staged A/B (user-entered order)
        let realWinner = null;
        if (sched.played && !sched._draw) {
            const aWonInSchedule = sched.scoreA > sched.scoreB;
            const schedAIsUserA = sched.playerA === a;
            realWinner = (aWonInSchedule === schedAIsUserA) ? 'A' : 'B';
        }

        staged.push({
            a, b, key,
            result: realWinner || 'NP',
            realWinner,
            wasPlayed: !!sched.played
        });

        inputA.value = '';
        inputB.value = '';
        renderStaged();
    }

    addBtn.addEventListener('click', addMatch);
    inputB.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMatch(); });

    function renderStaged() {
        if (staged.length === 0) {
            stagedHost.innerHTML = '<div class="whatif-empty">No matches staged yet. Add one above to start your scenario.</div>';
            return;
        }
        stagedHost.innerHTML = staged.map((s, i) => {
            const playedBadge = s.wasPlayed
                ? `<span class="whatif-played-badge" title="This match was already played in the real league">PLAYED</span>`
                : `<span class="whatif-unplayed-badge" title="Not played yet in the real league">UNPLAYED</span>`;
            const rollback = (s.wasPlayed && s.result === 'NP')
                ? `<span class="whatif-warn" title="You are rolling back a real result to Not Played in this scenario">&#9888;</span>`
                : '';
            return `
                <div class="whatif-row ${s.wasPlayed ? 'was-played' : ''}" data-idx="${i}">
                    <span class="whatif-row-player">${escapeHtml(s.a)}</span>
                    <span class="whatif-vs-small">vs</span>
                    <span class="whatif-row-player">${escapeHtml(s.b)}</span>
                    ${playedBadge}
                    <div class="whatif-result-group" role="radiogroup">
                        <button type="button" class="whatif-res ${s.result === 'A' ? 'active' : ''}" data-res="A" title="${escapeHtml(s.a)} wins">A wins</button>
                        <button type="button" class="whatif-res ${s.result === 'NP' ? 'active' : ''}" data-res="NP" title="Not played">NP</button>
                        <button type="button" class="whatif-res ${s.result === 'B' ? 'active' : ''}" data-res="B" title="${escapeHtml(s.b)} wins">B wins</button>
                    </div>
                    ${rollback}
                    <button type="button" class="whatif-del" title="Remove">&times;</button>
                </div>
            `;
        }).join('');

        stagedHost.querySelectorAll('.whatif-row').forEach(row => {
            const idx = Number(row.dataset.idx);
            row.querySelectorAll('.whatif-res').forEach(btn => {
                btn.addEventListener('click', () => {
                    staged[idx].result = btn.dataset.res;
                    renderStaged();
                });
            });
            row.querySelector('.whatif-del').addEventListener('click', () => {
                staged.splice(idx, 1);
                renderStaged();
            });
        });
    }
    renderStaged();

    clearBtn.addEventListener('click', () => {
        staged.length = 0;
        renderStaged();
        output.hidden = true;
    });

    runBtn.addEventListener('click', async () => {
        // Per-click summary of the staged scenario (which matches were
        // forced, not just "the button was clicked") — read via the existing
        // `[data-track]` path in js/analytics.js's click listener, which
        // fires on this same click event after this synchronous line runs.
        const stagedSummary = staged.map((s) =>
            s.result === 'NP' ? `${s.a} vs ${s.b} not played` : `${s.result === 'A' ? s.a : s.b} beats ${s.result === 'A' ? s.b : s.a}`
        ).join('; ');
        runBtn.dataset.track = `What if: ${staged.length} staged${stagedSummary ? ' — ' + stagedSummary : ''}`.slice(0, 300);

        addErr.textContent = '';
        if (staged.length === 0) {
            addErr.textContent = 'Add at least one match before running the simulation';
            return;
        }

        runBtn.disabled = true;
        runBtn.textContent = 'Simulating...';

        try {
            const matchLength = ctx.params.MatchLength || 7;

            // Start from the real state
            const simMatches = [...ctx.liveMatches];
            const simRemaining = ctx.allMatchesIncUnplayed.filter(m => !m.played).slice();

            const matchPredicate = (a, b) => (m) =>
                (m.playerA === a && m.playerB === b) ||
                (m.playerA === b && m.playerB === a);

            for (const s of staged) {
                const pred = matchPredicate(s.a, s.b);
                // Remove any existing entry for this pair in both arrays
                const pIdx = simMatches.findIndex(pred);
                if (pIdx !== -1) simMatches.splice(pIdx, 1);
                const rIdx = simRemaining.findIndex(pred);
                if (rIdx !== -1) simRemaining.splice(rIdx, 1);

                const sched = findSchedule(s.a, s.b);
                if (!sched) continue;

                if (s.result === 'NP') {
                    simRemaining.push({ ...sched, played: false, scoreA: null, scoreB: null, prA: null, prB: null, luckA: null, luckB: null });
                } else {
                    const winnerIsA = s.result === 'A';
                    simMatches.push({
                        playerA: s.a,
                        playerB: s.b,
                        scoreA: winnerIsA ? matchLength : 0,
                        scoreB: winnerIsA ? 0 : matchLength,
                        prA: null, prB: null,
                        luckA: null, luckB: null,
                        played: true,
                        round: sched.round,
                        _whatif: true
                    });
                }
            }

            const simStatsMap = computeAllStats(simMatches, ctx.allPlayersSet);
            const last300Map = await ensureLast300Map(ctx);

            const result = predictChampionship({
                statsMap: simStatsMap,
                remainingMatches: simRemaining,
                matchLength,
                leagueConfig: ctx.leagueConfig,
                last300Map,
                allPlayers: ctx.allPlayersSet,
                playedMatches: simMatches
            });

            output.hidden = false;
            if (result.method === 'montecarlo' && result.moe > 0) {
                moeHost.textContent = `Margin of Error: \u00b1${result.moe.toFixed(1)}% (95% confidence, ${result.iterations.toLocaleString()} simulations)`;
            } else {
                moeHost.textContent = `Exact calculation (${result.iterations.toLocaleString()} scenarios)`;
            }

            // Wire Top X control
            const wiTopXWrap = document.getElementById('whatif-topx-wrap');
            const wiTopXInput = document.getElementById('whatif-topx-input');
            wiTopXWrap.style.display = '';
            wiTopXInput.innerHTML = '';
            for (let x = 1; x <= result.n; x++) {
                const opt = document.createElement('option');
                opt.value = x;
                opt.textContent = x === 1 ? '1st place only' : x === result.n ? `Top ${x} (any finish)` : `Top ${x}`;
                wiTopXInput.appendChild(opt);
            }
            // Restore the previous "Show" choice; clamp to the new player count
            let currentX = Math.min(lastTopX, result.n);
            wiTopXInput.value = currentX;

            const getTopXPct = (r) =>
                computeTopXPct(result.finishRankCounts, r.playerIdx, result.n, result.totalWeight, currentX);

            // Use onchange (not addEventListener) so repeated runs don't stack listeners
            wiTopXInput.onchange = () => {
                currentX = parseInt(wiTopXInput.value);
                lastTopX = currentX;
                renderTable(expanded);
            };

            const showPR = ctx.leagueConfig.showPR;
            const showPRWins = ctx.leagueConfig.showPRWins;
            let expanded = false;
            const renderTable = (full) => {
                const sorted = [...result.rankings].sort((a, b) => getTopXPct(b) - getTopXPct(a));
                const data = full ? sorted : sorted.slice(0, 5);
                const rows = data.map((r, i) => {
                    const flagCode = getFlagCode(r.player, ctx.params.CustomFlags);
                    const pct = getTopXPct(r);
                    const barColor = pct > Math.min(20 * currentX, 80) ? 'var(--tier-high)' : pct > Math.min(5 * currentX, 30) ? 'var(--tier-mid)' : 'var(--tier-low)';
                    let ubcCols = '';
                    if (showPRWins) {
                        ubcCols = `<td>${r.points}</td><td>${r.avgPoints != null ? formatNumber(r.avgPoints) : '—'}</td>`;
                    }
                    return `<tr>
                        <td>${i + 1}</td>
                        <td class="player-cell">${ctx.playersMeta[r.player]?.hidden ? '' : `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">`} ${playerNameLink(r.player, ctx.playersMeta[r.player])}</td>
                        <td>${r.games}</td>
                        <td>${r.wins}</td>
                        <td>${r.losses}</td>
                        ${ubcCols}
                        <td>${showPR ? (r.meanPR != null ? formatNumber(r.meanPR) : '—') : (r.winRate != null ? formatPercent(r.winRate) : '—')}</td>
                        <td class="whatif-pct-cell">
                            <div class="whatif-pct-bar" style="--pct:${Math.min(pct, 100)}%;--bar-color:${barColor}">
                                ${pct.toFixed(1)}%
                            </div>
                        </td>
                    </tr>`;
                }).join('');

                const prHeader = showPR ? 'PR' : 'Win%';
                let ubcHeaders = '';
                if (showPRWins) {
                    ubcHeaders = `<th scope="col">PTS</th><th scope="col">Avg PTS</th>`;
                }
                const pctShortHeader = currentX === 1 ? 'Ch%' : `T${currentX}%`;
                tableHost.innerHTML = `
                    <div class="whatif-scroll-wrap">
                    <table class="dash-table whatif-table font-small" data-mf-table-id="B4">
                        <thead><tr>
                            <th scope="col">#</th><th scope="col" class="player-col">Player</th><th scope="col">MP</th><th scope="col">W</th><th scope="col">L</th>
                            ${ubcHeaders}
                            <th scope="col">${prHeader}</th><th scope="col">${pctShortHeader}</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                    </div>`;
                attachPlayerNameInteractions(tableHost, ctx.leagueId);
                measureScrollWrapStickyCols(tableHost.querySelector('.whatif-scroll-wrap'));
                attachStickyShadow(tableHost.querySelector('.whatif-scroll-wrap'));
            };

            renderTable(false);

            if (result.rankings.length > 5) {
                const total = result.rankings.length;
                expandBtn.style.display = '';
                expandBtn.textContent = `Show all (${total})`;
                expandBtn.onclick = () => {
                    expanded = !expanded;
                    renderTable(expanded);
                    expandBtn.textContent = expanded ? 'Show top 5' : `Show all (${total})`;
                };
            } else {
                expandBtn.style.display = 'none';
            }
        } catch (err) {
            tableHost.innerHTML = `<div class="error">Simulation failed: ${err.message}</div>`;
            output.hidden = false;
            console.error('What-if simulator error:', err);
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = 'Run Simulation';
        }
    });
}

function canonKey(a, b) {
    return [a, b].sort().join('|');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- F3 ----------
function renderRounds(ctx) {
    const { allMatchesIncUnplayed, roundCount, history, leagueId, playersMeta, params, leagueConfig } = ctx;
    let current = 1;
    let showAll = false;

    // Build a map: matchKey -> updatedAt from history
    const playedAt = new Map();
    for (const h of history.matches) {
        if (h.updatedAt) playedAt.set(matchKey(h.playerA, h.playerB), h.updatedAt);
    }

    const label = document.getElementById('round-label');
    const prev = document.getElementById('round-prev');
    const next = document.getElementById('round-next');
    const all = document.getElementById('round-all');

    function paint() {
        let list;
        if (showAll) {
            label.textContent = `All rounds (${roundCount})`;
            list = allMatchesIncUnplayed;
        } else {
            label.textContent = `Round ${current} / ${roundCount}`;
            list = allMatchesIncUnplayed.filter(m => m.round === current);
        }
        drawRoundTable(list, playedAt, leagueId, playersMeta, params.CustomFlags, leagueConfig);
        prev.disabled = showAll || current <= 1;
        next.disabled = showAll || current >= roundCount;
    }

    prev.addEventListener('click', () => { if (current > 1) { current--; paint(); } });
    next.addEventListener('click', () => { if (current < roundCount) { current++; paint(); } });
    all.addEventListener('click', () => { showAll = !showAll; paint(); });

    paint();
}

function drawRoundTable(matches, playedAt, leagueId, playersMeta = {}, customFlags = {}, leagueConfig = null) {
    const showPR = leagueConfig ? leagueConfig.showPR : true;
    const colCount = showPR ? 8 : 6;
    let html = `<div class="rounds-scroll-wrap"><table class="dash-table font-small" data-mf-table-id="B5"><thead><tr>`
        + `<th scope="col" class="player-col">Player A</th>`
        + `<th scope="col" class="player-col">Player B</th>`
        + `<th scope="col">Score</th>`
        + (showPR ? `<th scope="col">PR A</th><th scope="col">PR B</th>` : '')
        + `<th scope="col">Luck A</th>`
        + `<th scope="col">Luck B</th>`
        + `<th scope="col">Date</th>`
        + `</tr></thead><tbody>`;
    for (const m of matches) {
        const isPlayed = m.played;
        const updated = playedAt.get(matchKey(m.playerA, m.playerB));
        const playedCell = updated
            ? new Date(updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
            : (isPlayed ? '—' : '<span style="color:var(--color-text-muted)">unplayed</span>');
        const rowClass = isPlayed ? '' : 'unplayed-row';
        const flagA = getFlagCode(m.playerA, customFlags);
        const flagB = getFlagCode(m.playerB, customFlags);
        const hiddenA = !!(playersMeta[m.playerA] && playersMeta[m.playerA].hidden);
        const hiddenB = !!(playersMeta[m.playerB] && playersMeta[m.playerB].hidden);
        html += `<tr class="${rowClass}">`
            + `<td class="player-cell">${hiddenA ? '' : `<img class="flag" src="${flagUrl(flagA)}" alt="${flagA}">`} ${playerNameLink(m.playerA, playersMeta[m.playerA])}</td>`
            + `<td class="player-cell">${hiddenB ? '' : `<img class="flag" src="${flagUrl(flagB)}" alt="${flagB}">`} ${playerNameLink(m.playerB, playersMeta[m.playerB])}</td>`
            + `<td>${isPlayed ? m.scoreA + ' - ' + m.scoreB : '—'}</td>`
            + (showPR ? `<td>${isPlayed && m.prA != null ? formatNumber(m.prA) : '—'}</td><td>${isPlayed && m.prB != null ? formatNumber(m.prB) : '—'}</td>` : '')
            + `<td>${isPlayed && m.luckA != null ? formatNumber(m.luckA) : '—'}</td>`
            + `<td>${isPlayed && m.luckB != null ? formatNumber(m.luckB) : '—'}</td>`
            + `<td>${playedCell}</td></tr>`;
    }
    if (matches.length === 0) html += `<tr><td colspan="${colCount}">No matches</td></tr>`;
    html += '</tbody></table></div>';
    const host = document.getElementById('round-table');
    host.innerHTML = html;
    attachPlayerNameInteractions(host, leagueId);
    const wrap = host.querySelector('.rounds-scroll-wrap');
    if (wrap) {
        const th1 = wrap.querySelector('thead th:nth-child(1)');
        const th2 = wrap.querySelector('thead th:nth-child(2)');
        const measure = () => {
            const w1 = th1 && th1.getBoundingClientRect().width;
            const w2 = th2 && th2.getBoundingClientRect().width;
            if (w1 > 0) wrap.style.setProperty('--col1-w', w1 + 'px');
            if (w2 > 0) wrap.style.setProperty('--col2-w', w2 + 'px');
        };
        measure();
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(wrap);
        attachStickyShadow(wrap);
    }
}

// ---------- Remaining Matches (B6a / B6b / B6c) ----------
function renderRemainingMatches(ctx) {
    const { allMatchesIncUnplayed, params, playersMeta, lastModified } = ctx;
    const remaining = allMatchesIncUnplayed
        .filter(m => !m.played)
        .slice()
        .sort((a, b) => (a.round - b.round) || a.playerA.localeCompare(b.playerA) || a.playerB.localeCompare(b.playerB));

    const section = document.getElementById('remaining-section');
    if (remaining.length === 0) {
        if (section) section.hidden = true;
        return;
    }

    const countEl = document.getElementById('remaining-count');
    if (countEl) countEl.textContent = `(${remaining.length})`;

    // Sub-tabs — shared accordion (one panel open at a time; clicking an open
    // tab closes it). Panels are lazy-built on first open.
    mountAccordionTabs(document.getElementById('rem-tab-bar'), {
        tabs: [
            { id: 'rem-panel-b6a', label: 'All Remaining' },
            { id: 'rem-panel-b6b', label: 'Remaining Report' },
            { id: 'rem-panel-b6c', label: 'Per Player' },
        ],
        onOpen: (panelId, panel) => {
            if (panel._built) return;
            panel._built = true;
            if (panelId === 'rem-panel-b6a') buildB6aPanel(panel, remaining, params, playersMeta, lastModified);
            else if (panelId === 'rem-panel-b6b') buildB6bPanel(panel, ctx, remaining, lastModified);
            else if (panelId === 'rem-panel-b6c') buildB6cPanel(panel, ctx, remaining, lastModified);
        },
    });
}

// Export control shared by B6a/B6b/B6c: a right-aligned row holding either
// the "Export Image" button or — when the table exceeds MAX_EXPORT_ROWS —
// a notice explaining why export is unavailable (a taller table can't fit
// the fixed WhatsApp frame at a readable font).
function buildExportControl(rowCount, onExport) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:var(--space-sm);';
    if (rowCount > MAX_EXPORT_ROWS) {
        const note = document.createElement('div');
        note.className = 'img-export-notice';
        note.style.cssText = 'color:var(--color-text-muted);font-size:var(--fs-085);text-align:right;';
        note.textContent = `Image export supports up to ${MAX_EXPORT_ROWS} rows (this table has ${rowCount}).`;
        row.appendChild(note);
    } else {
        const btn = document.createElement('button');
        btn.className = 'img-export-btn';
        btn.textContent = 'Export Image';
        btn.addEventListener('click', onExport);
        row.appendChild(btn);
    }
    return row;
}

function buildB6aPanel(panel, remaining, params, playersMeta, lastModified) {
    if (remaining.length > 0) {
        panel.appendChild(buildExportControl(remaining.length, () => {
            const sourceTable = panel.querySelector('.rem-b6a-wrap table');
            exportRemainingMatchesImage(sourceTable, params.LeagueTitle || '', formatAsOf(lastModified), params.LeagueType || 'doubling');
        }));
    }
    const wrap = document.createElement('div');
    wrap.className = 'rem-b6a-wrap';
    wrap.innerHTML = remaining.length === 0
        ? '<div style="padding:var(--space-md);color:var(--color-text-muted)">No remaining matches — season complete.</div>'
        : buildRemainingListHtml(remaining, params.CustomFlags, playersMeta);
    panel.appendChild(wrap);
}

function buildB6bPanel(panel, ctx, remaining, lastModified) {
    const { params, liveMatches, allPlayersSet, leagueConfig } = ctx;
    const statsMap = computeAllStats(liveMatches, allPlayersSet);
    const rankings = buildRankings(statsMap, leagueConfig, liveMatches);
    const n = allPlayersSet.size;
    const maxGames = n > 0 ? n - 1 : 0;
    const halfThreshold = maxGames / 2;

    const playerRemainingData = rankings.map(r => ({
        player: r.player,
        games: r.games,
        remaining: Math.max(0, maxGames - r.games),
        flagCode: getFlagCode(r.player, params.CustomFlags)
    })).sort((a, b) => b.remaining - a.remaining);

    const maxRem = playerRemainingData.length > 0 ? playerRemainingData[0].remaining : 0;
    const minRem = playerRemainingData.length > 0 ? playerRemainingData[playerRemainingData.length - 1].remaining : 0;
    const hasAnyBelowHalf = playerRemainingData.some(p => p.games <= halfThreshold);

    panel.appendChild(buildExportControl(playerRemainingData.length, () => {
        const sourceTable = panel.querySelector('.rem-b6b-wrap table');
        exportB6bImage(sourceTable, params.LeagueTitle || ctx.leagueId, formatAsOf(lastModified), params.LeagueType || 'doubling');
    }));

    const wrap = document.createElement('div');
    wrap.className = 'rem-b6b-wrap';
    wrap.innerHTML = buildB6bTableHtml(playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames);
    panel.appendChild(wrap);
}

function buildB6bTableHtml(playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames) {
    let html = '<table class="dash-table font-small player-remaining-table" data-mf-table-id="B6b"><thead><tr>'
        + '<th scope="col" class="player-col">Player</th>'
        + '<th scope="col">Remaining</th>'
        + '</tr></thead><tbody>';
    let separatorInserted = false;
    for (const p of playerRemainingData) {
        if (!separatorInserted && hasAnyBelowHalf && p.games >= halfThreshold) {
            html += '<tr class="player-remaining-divider player-remaining-divider--bold"><td colspan="2">&#8212; played &ge; half &#8212;</td></tr>';
            separatorInserted = true;
        }
        const isBold = !separatorInserted;
        const color = colorForValueInverted(p.remaining, minRem, maxRem);
        const boldStyle = isBold ? 'font-weight:700' : '';
        html += `<tr>`
            + `<td class="player-cell" style="${boldStyle}"><img class="flag" src="${flagUrl(p.flagCode)}" alt="${p.flagCode}"> ${escapeHtml(p.player)}</td>`
            + `<td style="${boldStyle}"><span style="color:${color};font-weight:700">${p.remaining}</span> / ${maxGames}</td>`
            + `</tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function buildB6cPanel(panel, ctx, remaining, lastModified) {
    const { params, playersMeta } = ctx;
    const allPlayers = [...ctx.allPlayersSet].filter(p => p && p !== 'Bye').sort();

    const unplayedByPlayer = new Map();
    for (const p of allPlayers) unplayedByPlayer.set(p, []);
    for (const m of remaining) {
        if (m.playerA && m.playerA !== 'Bye' && unplayedByPlayer.has(m.playerA))
            unplayedByPlayer.get(m.playerA).push(m.playerB);
        if (m.playerB && m.playerB !== 'Bye' && unplayedByPlayer.has(m.playerB))
            unplayedByPlayer.get(m.playerB).push(m.playerA);
    }

    const outer = document.createElement('div');
    outer.className = 'rem-b6c-outer';
    outer.innerHTML = `
        <div class="rem-b6c-content">
            <div class="rem-b6c-search-row">
                <input type="text" id="rem-b6c-input" class="rem-b6c-input app-search-input"
                    placeholder="Search player…" autocomplete="off">
            </div>
            <div id="rem-b6c-result"></div>
        </div>`;
    panel.appendChild(outer);

    const input = outer.querySelector('#rem-b6c-input');
    const result = outer.querySelector('#rem-b6c-result');
    const title = params.LeagueTitle || ctx.leagueId;

    function showPlayer(rawVal) {
        const lower = rawVal.trim().toLowerCase();
        if (!lower) { result.innerHTML = ''; return; }
        const player = allPlayers.find(p => p.toLowerCase() === lower);
        if (!player) { result.innerHTML = ''; return; }

        const opponents = (unplayedByPlayer.get(player) || []).slice().sort();
        result.innerHTML = `
            <div class="rem-b6c-header">
                <span class="rem-b6c-player-name">${escapeHtml(player)}</span>
                &mdash; <span class="rem-b6c-rem-count">${opponents.length} remaining match${opponents.length !== 1 ? 'es' : ''}</span>
            </div>
            <div class="rem-b6c-export-row"></div>
            <div class="rem-b6c-wrap">${buildB6cTableHtml(opponents, params.CustomFlags, playersMeta)}</div>`;

        result.querySelector('.rem-b6c-export-row').appendChild(
            buildExportControl(opponents.length, () => {
                const sourceTable = result.querySelector('.rem-b6c-wrap table');
                exportB6cImage(sourceTable, title, player, formatAsOf(lastModified), params.LeagueType || 'doubling');
            })
        );
    }

    input.addEventListener('input', () => showPlayer(input.value));
    input.addEventListener('change', () => showPlayer(input.value));
    mountCombobox(input, { getOptions: () => allPlayers });
}

function buildB6cTableHtml(opponents, customFlags, playersMeta) {
    if (opponents.length === 0) {
        return `<div style="color:var(--color-text-muted);padding:var(--space-sm);text-align:center">All matches played!</div>`;
    }
    let html = '<table class="dash-table font-small rem-b6c-table" data-mf-table-id="B6c"><thead><tr>'
        + '<th scope="col" class="player-col">Unplayed Opponent</th>'
        + '</tr></thead><tbody>';
    for (const opp of opponents) {
        const flagCode = getFlagCode(opp, customFlags);
        const titlesHtml = getTitleAbbreviationsHtml(playersMeta[opp]);
        html += `<tr><td class="player-cell"><img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${escapeHtml(opp)}${titlesHtml}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function buildRemainingListHtml(matches, customFlags, playersMeta) {
    let html = `<table class="dash-table font-small" data-mf-table-id="B6a"><thead><tr>`
             + `<th scope="col" class="player-col">Player A</th>`
             + `<th scope="col" class="player-col">Player B</th>`
             + `</tr></thead><tbody>`;
    for (const m of matches) {
        const flagA = getFlagCode(m.playerA, customFlags);
        const flagB = getFlagCode(m.playerB, customFlags);
        const titlesA = getTitleAbbreviationsHtml(playersMeta[m.playerA]);
        const titlesB = getTitleAbbreviationsHtml(playersMeta[m.playerB]);
        html += `<tr class="unplayed-row">`
             +  `<td class="player-cell"><img class="flag" src="${flagUrl(flagA)}" alt="${flagA}"> ${m.playerA}${titlesA}</td>`
             +  `<td class="player-cell"><img class="flag" src="${flagUrl(flagB)}" alt="${flagB}"> ${m.playerB}${titlesB}</td>`
             +  `</tr>`;
    }
    html += '</tbody></table>';
    return html;
}

// "Last updated <date>" subtitle suffix shared by B6a/B6b/B6c exports —
// mirrors the league header's "Last updated" line, date only (no time).
function formatAsOf(lastModified) {
    const date = formatLastUpdatedDate(lastModified);
    return date ? `Last updated ${date}` : '';
}

// Thin wrappers around the shared exportWhatsAppTableImage() helper. The
// dashboard exports differ only in their subtitle and filename \u2014 the
// fixed 4:5 frame, header band, and font-fit are identical.
// (Row-count is pre-gated by buildExportControl, so these only fire \u2264 30 rows.)
//
// All three are narrow tables (B6a/B6b: 2 cols, B6c: 1 col), so they pass
// shrinkToContent \u2014 stretching them across the frame would leave each cell
// mostly empty. Columns size to their text and the table is centred instead.

function exportRemainingMatchesImage(sourceTable, title, asOf, leagueType) {
    if (!sourceTable) return;
    const count = sourceTable.querySelectorAll('tbody tr').length;
    const subtitle = `Remaining Matches (${count})${asOf ? ' \u2014 ' + asOf : ''}`;
    return exportWhatsAppTableImage({ sourceTable, title, subtitle, leagueType, shrinkToContent: true, filename: `${title}_${leagueTypeLabel(leagueType)}_Remaining` });
}

function exportB6bImage(sourceTable, title, asOf, leagueType) {
    if (!sourceTable) return;
    const subtitle = `Remaining Matches Report${asOf ? ' \u2014 ' + asOf : ''}`;
    return exportWhatsAppTableImage({ sourceTable, title, subtitle, leagueType, shrinkToContent: true, filename: `${title}_${leagueTypeLabel(leagueType)}_Remaining_Report` });
}

function exportB6cImage(sourceTable, title, player, asOf, leagueType) {
    if (!sourceTable) return;
    const count = sourceTable.querySelectorAll('tbody tr').length;
    const matchesWord = count === 1 ? 'match' : 'matches';
    const subtitle = `${player} \u2014 ${count} remaining ${matchesWord}${asOf ? ' \u2014 ' + asOf : ''}`;
    return exportWhatsAppTableImage({ sourceTable, title, subtitle, leagueType, shrinkToContent: true, filename: `${title}_${leagueTypeLabel(leagueType)}_${player}_Remaining` });
}

// ---------- F4 ----------
function renderPlayerSection(ctx) {
    const { allPlayersSet, liveMatches, leagueId } = ctx;
    const players = [...allPlayersSet].sort();
    const totalMatchesPerPlayer = players.length - 1;

    const container = document.getElementById('charts-container');

    // All live chart panels. Every panel is redrawn together so they stay on a
    // single shared Y scale per metric (PR default 0..20, Luck default ±5).
    const panels = [];
    const sharedScale = {
        pr:   computeNiceRange('pr',   []),
        luck: computeNiceRange('luck', []),
    };

    function recomputeScales() {
        const byMetric = { pr: [], luck: [] };
        for (const p of panels) {
            const metric = p.metricSel.value;
            const bucket = byMetric[metric];
            for (const m of buildPlayerSeries(liveMatches, p.playerSel.value)) {
                const v = metric === 'luck' ? m.luckSelf : m.prSelf;
                if (v != null) bucket.push(v);
            }
        }
        sharedScale.pr   = computeNiceRange('pr',   byMetric.pr);
        sharedScale.luck = computeNiceRange('luck', byMetric.luck);
    }

    function redrawAll() {
        recomputeScales();
        for (const p of panels) p.redraw();
    }

    function buildPanel(initialPlayer) {
        const panel = document.createElement('div');
        panel.className = 'chart-panel';
        panel.innerHTML = `
            <div class="dash-controls">
                <label>Player:</label>
                <select class="player-pick">${players.map(p => `<option value="${p}" ${p === initialPlayer ? 'selected' : ''}>${displayPlayerName(p)}</option>`).join('')}</select>
                <label>Metric:</label>
                <select class="metric-pick">
                    <option value="pr">PR</option>
                    <option value="luck">Luck</option>
                </select>
                <a class="open-full-btn player-card-link" href="#" title="Open full player card">Open player card &rsaquo;</a>
                <button class="remove-chart" title="Remove this chart">&times;</button>
            </div>
            <div class="chart-host"></div>
        `;
        container.appendChild(panel);

        const playerSel = panel.querySelector('.player-pick');
        const metricSel = panel.querySelector('.metric-pick');
        const link = panel.querySelector('.player-card-link');
        const host = panel.querySelector('.chart-host');
        const removeBtn = panel.querySelector('.remove-chart');

        function redraw() {
            const player = playerSel.value;
            const metric = metricSel.value;
            link.href = playerLeagueUrl(leagueId, player);
            const matches = buildPlayerSeries(liveMatches, player);
            drawPlayerBarChart(host, matches, metric, totalMatchesPerPlayer, sharedScale[metric]);
        }

        const entry = { panel, playerSel, metricSel, redraw };
        panels.push(entry);

        playerSel.addEventListener('change', redrawAll);
        metricSel.addEventListener('change', redrawAll);
        removeBtn.addEventListener('click', () => {
            if (panels.length > 1) {
                panel.remove();
                panels.splice(panels.indexOf(entry), 1);
                redrawAll();
            }
        });
    }

    buildPanel(players[0]);

    document.getElementById('add-chart').addEventListener('click', () => {
        buildPanel(players[0]);
        redrawAll();
    });

    redrawAll();
}

function buildPlayerSeries(liveMatches, player) {
    return liveMatches
        .filter(m => m.playerA === player || m.playerB === player)
        .map(m => {
            const isA = m.playerA === player;
            return {
                opponent: isA ? m.playerB : m.playerA,
                scoreSelf: isA ? m.scoreA : m.scoreB,
                scoreOpp: isA ? m.scoreB : m.scoreA,
                prSelf: isA ? m.prA : m.prB,
                luckSelf: isA ? m.luckA : m.luckB,
                updatedAt: m.updatedAt || null
            };
        })
        .filter(m => m.scoreSelf != null && (m.scoreSelf > 0 || m.scoreOpp > 0))
        .sort((a, b) => {
            if (!a.updatedAt && !b.updatedAt) return 0;
            if (!a.updatedAt) return 1;
            if (!b.updatedAt) return -1;
            return new Date(a.updatedAt) - new Date(b.updatedAt);
        });
}

// ---------- PR <-> Result correlation (Charts tab) ----------

/** Per-player match list with both PRs present, needed for the advantage (x = prOpp - prSelf). */
function buildPlayerAdvantageSeries(liveMatches, player) {
    return liveMatches
        .filter(m => m.playerA === player || m.playerB === player)
        .map(m => {
            const isA = m.playerA === player;
            return {
                opponent: isA ? m.playerB : m.playerA,
                scoreSelf: isA ? m.scoreA : m.scoreB,
                scoreOpp: isA ? m.scoreB : m.scoreA,
                prSelf: isA ? m.prA : m.prB,
                prOpp: isA ? m.prB : m.prA,
                luckSelf: isA ? m.luckA : m.luckB,
                updatedAt: m.updatedAt || null
            };
        })
        .filter(m => m.scoreSelf != null && (m.scoreSelf > 0 || m.scoreOpp > 0) && m.prSelf != null && m.prOpp != null)
        .map(m => ({ ...m, advantage: m.prOpp - m.prSelf, win: m.scoreSelf > m.scoreOpp }))
        .sort((a, b) => {
            if (!a.updatedAt && !b.updatedAt) return 0;
            if (!a.updatedAt) return 1;
            if (!b.updatedAt) return -1;
            return new Date(a.updatedAt) - new Date(b.updatedAt);
        });
}

/** One entry per league match: x = PR of the loser minus PR of the winner (no colour). */
function buildGeneralAdvantageSeries(liveMatches) {
    return liveMatches
        .filter(m => m.scoreA != null && m.scoreB != null && (m.scoreA > 0 || m.scoreB > 0) && m.prA != null && m.prB != null && m.scoreA !== m.scoreB)
        .map(m => {
            const aWon = m.scoreA > m.scoreB;
            return {
                winner: aWon ? m.playerA : m.playerB,
                loser: aWon ? m.playerB : m.playerA,
                scoreWinner: aWon ? m.scoreA : m.scoreB,
                scoreLoser: aWon ? m.scoreB : m.scoreA,
                prWinner: aWon ? m.prA : m.prB,
                prLoser: aWon ? m.prB : m.prA,
                updatedAt: m.updatedAt || null
            };
        })
        .map(m => ({ ...m, advantage: m.prLoser - m.prWinner }))
        .sort((a, b) => {
            if (!a.updatedAt && !b.updatedAt) return 0;
            if (!a.updatedAt) return 1;
            if (!b.updatedAt) return -1;
            return new Date(a.updatedAt) - new Date(b.updatedAt);
        });
}

/** Symmetric X domain shared by every League row: +/- the single largest PR gap seen in the league. */
function computeCorrelationDomain(generalSeries) {
    let maxAbs = 0;
    for (const m of generalSeries) maxAbs = Math.max(maxAbs, Math.abs(m.advantage));
    const bound = Math.max(1, Math.ceil(maxAbs));
    return { xMin: -bound, xMax: bound };
}

/**
 * Symmetric X domain for the player rows (PR <-> Result Correlation Player
 * section) — independent of the League section's domain above, and never
 * touched by the cross-league all-time fetch. +/- 10% padding beyond the
 * single largest PR gap so the outermost dot isn't flush against the axis
 * edge. Every player's advantage magnitude for a given match equals the
 * league-wide advantage magnitude for that same match (just the sign flips
 * depending on which side of the match you're viewing from), so the same
 * `generalSeries` can be reused to find that largest gap.
 */
function computePlayerDomain(generalSeries) {
    let maxAbs = 0;
    for (const m of generalSeries) maxAbs = Math.max(maxAbs, Math.abs(m.advantage));
    const bound = Math.max(1, maxAbs * 1.1);
    return { xMin: -bound, xMax: bound };
}

/**
 * Fixed-width (1 PR point) density buckets for the "All League Matches"
 * heatmap. `shift` (whole PR points) is added to every match's advantage
 * before binning — the same shifted value also feeds the Model validation
 * recompute in renderPrCorrelationSection, so nudging the shift control
 * visibly slides the heatmap left/right along the fixed axis.
 *
 * `dropOutOfRange` controls what happens to a match whose (shifted)
 * advantage falls outside [xMin, xMax): false (default) folds it into the
 * nearest edge bin (used for the shift control, so no match ever vanishes);
 * true drops it entirely (used by the "Trim to 99%" toggle, which is meant
 * to hide the outlier bins rather than pile them up at the edge). Either
 * way the percentage denominator stays the full `rows.length`.
 */
function buildDensityBuckets(rows, shift, xMin, xMax, dropOutOfRange = false) {
    const lo = Math.floor(xMin), hi = Math.ceil(xMax);
    const counts = new Map();
    for (const r of rows) {
        const raw = r.advantage + shift;
        if (dropOutOfRange && (raw < lo || raw >= hi)) continue;
        const bx = Math.max(lo, Math.min(hi - 1, Math.floor(raw)));
        counts.set(bx, (counts.get(bx) || 0) + 1);
    }
    const total = rows.length;
    const buckets = [];
    for (let x = lo; x < hi; x++) {
        const count = counts.get(x) || 0;
        buckets.push({ x0: x, x1: x + 1, count, pct: total > 0 ? (count / total * 100) : 0 });
    }
    return buckets;
}

// Below this many matches, a sample mean/std isn't a meaningful summary —
// the "Gaussian fit" toggle is disabled and explains why instead of drawing
// a curve off 1-2 points.
const MIN_GAUSSIAN_N = 5;

function meanStd(values) {
    const n = values.length;
    const mean = n ? values.reduce((s, v) => s + v, 0) / n : 0;
    const variance = n ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
    return { mean, std: Math.sqrt(variance) };
}

/**
 * Plain-language explanation of the fitted mean/std shown by the "Gaussian
 * fit" toggle — just what mu and sigma mean for this row's data, nothing
 * more (the win-probability comparison lives in the separate "Explanation"
 * popup, buildExplanationTableHtml, below).
 */
function buildGaussianExplainerHtml(values) {
    const { mean, std } = meanStd(values);
    const meanDir = mean >= 0 ? 'better (a lower PR)' : 'worse (a higher PR)';
    const meanDirHe = mean >= 0 ? 'טוב יותר (PR נמוך יותר)' : 'גרוע יותר (PR גבוה יותר)';
    const loBand = (mean - std).toFixed(2);
    const hiBand = (mean + std).toFixed(2);

    return `
        <button class="predictor-info-close corr-gaussian-popup-close" aria-label="Close">&times;</button>
        <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
        <div class="popup-lang-en" data-lang="en">
        <h4>What do &mu; and &sigma; actually mean?</h4>
        <p><b>&mu; (mean) = ${mean.toFixed(2)}</b>: on average, across these matches, the player who actually
        won had a PR about ${Math.abs(mean).toFixed(2)} points ${meanDir} than the player who lost that
        match.</p>
        <p><b>&sigma; (standard deviation) = ${std.toFixed(2)}</b>: results vary a lot around that average
        &mdash; about two-thirds of matches (one standard deviation either side of the mean) had a winner-side
        PR gap somewhere between <b>${loBand}</b> and <b>${hiBand}</b>.</p>
        </div>
        <div class="popup-lang-he" data-lang="he">
        <h4>מה בעצם &mu; ו-&sigma; אומרים?</h4>
        <p><b>&mu; (ממוצע) = ${mean.toFixed(2)}</b>: בממוצע, על פני המשחקים האלה, לשחקן שבאמת
        ניצח היה PR טוב בכ-${Math.abs(mean).toFixed(2)} נקודות ${meanDirHe} מהשחקן שהפסיד באותו
        משחק.</p>
        <p><b>&sigma; (סטיית תקן) = ${std.toFixed(2)}</b>: התוצאות משתנות הרבה סביב הממוצע הזה
        &mdash; בכשני שליש מהמשחקים (סטיית תקן אחת לכל צד של הממוצע) פער ה-PR מצד המנצח היה
        אי שם בין <b>${loBand}</b> ל-<b>${hiBand}</b>.</p>
        </div>
    `;
}

// Lanczos-approximation log-gamma, used to get an exact binomial PMF/CDF at
// any n without factorial overflow (n here can run into the thousands, for
// "All League Matches" pooled across every league).
function logGamma(x) {
    const g = 7;
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function binomPmf(n, k, p) {
    if (p <= 0) return k === 0 ? 1 : 0;
    if (p >= 1) return k === n ? 1 : 0;
    const logCoeff = logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
    return Math.exp(logCoeff + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

// P(X <= k)
function binomCdfAtMost(n, k, p) {
    let sum = 0;
    for (let i = 0; i <= k; i++) sum += binomPmf(n, i, p);
    return Math.min(1, sum);
}

// P(X >= k)
function binomCdfAtLeast(n, k, p) {
    let sum = 0;
    for (let i = k; i <= n; i++) sum += binomPmf(n, i, p);
    return Math.min(1, sum);
}

// One-tailed "how likely is a result this far (or further) from what the
// table predicts, if the table's number were exactly right" — P(X <= k) on
// the low side, P(X >= k) on the high side. Never exceeds ~0.5 (a result
// bang on the expected mean has about even odds of landing on either side
// of itself), so 0.5 is used as the "typical" anchor for coloring.
function binomTailLikelihood(n, k, p) {
    const mean = n * p;
    return k <= mean ? binomCdfAtMost(n, k, p) : binomCdfAtLeast(n, k, p);
}

// Plain-language read of a Likelihood value, for the table's own "What this
// means" column — so a reader doesn't need to interpret the raw % themselves.
const LIKELIHOOD_BANDS = {
    en: [
        { max: 0.02, text: 'Hard to explain by luck alone' },
        { max: 0.05, text: 'Notably unusual' },
        { max: 0.15, text: 'Mildly unusual' },
        { max: Infinity, text: 'Normal, expected variation' },
    ],
    he: [
        { max: 0.02, text: 'קשה להסביר במקרה בלבד' },
        { max: 0.05, text: 'חריג במידה ניכרת' },
        { max: 0.15, text: 'חריג במידה קלה' },
        { max: Infinity, text: 'שונות רגילה, צפויה' },
    ],
};

function likelihoodAssessment(likelihood, lang = 'en') {
    return LIKELIHOOD_BANDS[lang].find(b => likelihood <= b.max).text;
}

/**
 * "Explanation" popup for the All League Matches row: a gap-by-gap table
 * comparing the site's real win-probability table against this row's own
 * data, using the same integer-centred, mirrored-window bins as the
 * histogram — for a gap of G, every match landing within half a point of +G
 * (favourite winning by about that much) versus within half a point of -G
 * (an upset by about that much). G=0 is skipped: it's its own mirror, so
 * it's trivially 50% either way and says nothing about calibration.
 */
function buildExplanationTableHtml(rows, shift, mlIdx) {
    const gapRows = [];
    for (let gap = 1; gap <= 10; gap++) {
        const tablePct = getWinProbability(0, gap, mlIdx) * 100;
        const posCount = rows.filter(r => r.advantage + shift >= gap - 0.5 && r.advantage + shift < gap + 0.5).length;
        const negCount = rows.filter(r => r.advantage + shift >= -gap - 0.5 && r.advantage + shift < -gap + 0.5).length;
        const total = posCount + negCount;
        if (total === 0) {
            gapRows.push({ gap, total, tablePct });
            continue;
        }
        const dataPct = (posCount / total) * 100;
        const error = dataPct - tablePct;
        const p = tablePct / 100;
        const likelihood = binomTailLikelihood(total, posCount, p);
        gapRows.push({ gap, total, posCount, negCount, tablePct, dataPct, error, likelihood });
    }

    // Win%-column color scale is dynamic, stretched to the actual spread of
    // values in THIS table (both columns share one scale, per the same "so
    // they're visually comparable" reasoning as before) — not a fixed
    // 50-100% band, since a table with a narrow real spread would otherwise
    // render as one flat color end to end.
    const pctValues = gapRows.flatMap(r => [r.dataPct, r.tablePct]).filter(v => v != null);
    const pctMin = pctValues.length ? Math.min(...pctValues) : 50;
    const pctMax = pctValues.length ? Math.max(...pctValues) : 100;

    function renderTable(lang) {
        let bodyRows = '';
        for (const r of gapRows) {
            if (r.dataPct == null) {
                bodyRows += `<tr><td>${r.gap}</td><td>0</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td>
                    <td>${r.tablePct.toFixed(1)}%</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td></tr>`;
                continue;
            }
            const dataColor = colorForValue(r.dataPct, pctMin, pctMax);
            const tableColor = colorForValue(r.tablePct, pctMin, pctMax);
            // Error/Likelihood/"What this means" all use the separate
            // confidence (blue-amber-red) theme, keyed off this row's own
            // likelihood, so the three cells read as one consistent verdict on
            // the row rather than three independently-scaled numbers.
            const confColor = colorForConfidence(Math.min(r.likelihood, 0.5), 0, 0.5);
            bodyRows += `<tr>
                <td>${r.gap}</td>
                <td>${r.total}</td>
                <td>${r.posCount}</td>
                <td>${r.negCount}</td>
                <td style="color:${dataColor}">${r.dataPct.toFixed(1)}%</td>
                <td style="color:${tableColor}">${r.tablePct.toFixed(1)}%</td>
                <td style="color:${confColor}">${r.error >= 0 ? '+' : ''}${r.error.toFixed(1)}</td>
                <td style="color:${confColor}">${(r.likelihood * 100).toFixed(1)}%</td>
                <td style="color:${confColor}">${likelihoodAssessment(r.likelihood, lang)}</td>
            </tr>`;
        }

        const headers = lang === 'he'
            ? ['הפרש PR', 'משחקים', 'ניצחונות המועדף', 'הפסדי המועדף', 'Win% של הנתונים', 'Win% של הטבלה', 'שגיאה', 'Likelihood', 'המשמעות']
            : ['PR gap', 'Matches', 'Favourite wins', 'Favourite loses', 'Win% of data', 'Win% of table', 'Error', 'Likelihood', 'What this means'];

        return `
            <div class="corr-band-table-scroll">
                <table class="corr-band-table">
                    <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
                    ${bodyRows}
                </table>
            </div>
        `;
    }

    return `
        <button class="predictor-info-close corr-explanation-popup-close" aria-label="Close">&times;</button>
        <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
        <div class="popup-lang-en" data-lang="en">
        <h4>Model validation: does the data match the table?</h4>
        <p>This table is built only from matches actually played &mdash; not a theoretical curve. For each PR
        gap, it checks how often the favourite really won against what the <i>PR Win-Probability Table</i>
        predicts. "Likelihood" is a plain read of how surprising that row's result is &mdash; explained in the
        last column, so you don't need to interpret the number yourself.</p>
        ${renderTable('en')}
        </div>
        <div class="popup-lang-he" data-lang="he">
        <h4>אימות מודל: האם הנתונים תואמים את הטבלה?</h4>
        <p>הטבלה הזו בנויה רק ממשחקים ששוחקו בפועל &mdash; לא מעקומה תיאורטית. עבור כל פער
        PR, היא בודקת כמה פעמים המועדף באמת ניצח, לעומת מה שה<i>PR Win-Probability Table</i>
        חוזה. "Likelihood" הוא קריאה פשוטה של עד כמה תוצאת השורה מפתיעה &mdash; מוסברת בעמודה
        האחרונה, כך שאין צורך לפרש את המספר בעצמכם.</p>
        ${renderTable('he')}
        </div>
    `;
}

function corrMatchInfoHtml(m) {
    const dateStr = m.updatedAt
        ? new Date(m.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';
    if (m.opponent !== undefined) {
        const prStr = m.prSelf != null ? m.prSelf.toFixed(2) : '—';
        const luckStr = m.luckSelf != null ? m.luckSelf.toFixed(2) : '—';
        return `
            <div class="cip-row cip-title">${m.win ? 'Won' : 'Lost'} vs <b>${displayPlayerName(m.opponent)}</b></div>
            <div class="cip-row">
                <span class="cip-item"><span class="cip-k">Score</span><span class="cip-v">${m.scoreSelf} - ${m.scoreOpp}</span></span>
                <span class="cip-item"><span class="cip-k">PR</span><span class="cip-v">${prStr}</span></span>
                <span class="cip-item"><span class="cip-k">Luck</span><span class="cip-v">${luckStr}</span></span>
                <span class="cip-item"><span class="cip-k">Date</span><span class="cip-v">${dateStr}</span></span>
            </div>
        `;
    }
    const prW = m.prWinner != null ? m.prWinner.toFixed(2) : '—';
    const prL = m.prLoser != null ? m.prLoser.toFixed(2) : '—';
    return `
        <div class="cip-row cip-title"><b>${displayPlayerName(m.winner)}</b> def. <b>${displayPlayerName(m.loser)}</b></div>
        <div class="cip-row">
            <span class="cip-item"><span class="cip-k">Score</span><span class="cip-v">${m.scoreWinner} - ${m.scoreLoser}</span></span>
            <span class="cip-item"><span class="cip-k">PR (W/L)</span><span class="cip-v">${prW} / ${prL}</span></span>
            <span class="cip-item"><span class="cip-k">Date</span><span class="cip-v">${dateStr}</span></span>
        </div>
    `;
}

// Keeps a marker's/value's horizontal position a few points shy of the bar's
// own edges, so the value text (centred on that position) never overflows
// past the bar into the caption or label column at the extremes (0 or 1).
function clampPct(pct) {
    return Math.max(8, Math.min(92, pct));
}

// Signed-luck: only meaningful for a player row (real win/loss variation) —
// never call this for the general row, see signedLuckScore()'s doc comment.
function applyLuckPill(pillEl, luck) {
    if (luck == null) {
        pillEl.innerHTML = `<span class="brier-caption">Luck</span><span class="luck-mini-scale"><span class="luck-mini-track"></span></span><span class="brier-label">&mdash;</span>`;
        pillEl.title = 'No rated matches yet.';
        return;
    }
    const { text, color } = luckAssessment(luck, pillEl);
    const markerPct = Math.max(0, Math.min(100, (luck + 1) / 2 * 100));
    const valuePct = clampPct(markerPct);
    pillEl.innerHTML = `
        <span class="brier-caption">Luck</span>
        <span class="luck-mini-scale">
            <span class="luck-mini-track"></span>
            <span class="brier-mini-marker" style="left:${markerPct}%"></span>
            <b class="brier-mini-value" style="left:${valuePct}%">${luck >= 0 ? '+' : ''}${luck.toFixed(3)}</b>
        </span>
        <span class="brier-label" style="color:${color}">${text}</span>
    `;
    pillEl.title = 'Signed-luck score: +1 = maximally lucky (always the underdog, always won), -1 = maximally unlucky (always favoured, always lost), 0 = results matched the PR model exactly.';
}

// Scopes wireLangPopup to a single section, so its flag buttons only ever
// affect (and read) that section's own popup — needed because multiple
// sections' flag buttons share the same class, and querySelectorAll from
// document would otherwise wire every section's flags to whichever popup
// was passed in.
function wireSectionLangPopup(sectionId, btnId, popupId, closeId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    wireLangPopup(section, {
        btn: document.getElementById(btnId),
        popup: document.getElementById(popupId),
        close: document.getElementById(closeId),
    });
}

function renderPrCorrelationSection(ctx) {
    const { liveMatches } = ctx;
    const players = [...ctx.allPlayersSet].sort();
    const container = document.getElementById('corr-container');
    const leagueContainer = document.getElementById('corr-league-container');
    if (!container || !leagueContainer) return;

    wireSectionLangPopup('pr-corr-section', 'pr-corr-info-btn', 'pr-corr-info-popup', 'pr-corr-info-close');
    wireSectionLangPopup('league-corr-section', 'league-corr-info-btn', 'league-corr-info-popup', 'league-corr-info-close');

    const generalSeries = buildGeneralAdvantageSeries(liveMatches);
    const domain = computeCorrelationDomain(generalSeries);
    const playerDomain = computePlayerDomain(generalSeries);
    const panels = [];

    // League row (current league only) — always present, uncoloured, top of
    // the League PR <-> Result Correlation section.
    const generalPanel = document.createElement('div');
    generalPanel.className = 'chart-panel corr-panel corr-panel--general';
    const generalMlIdx = nearestMatchLengthIdx(ctx.params.MatchLength || 7);
    const generalStatsMap = computeAllStats(liveMatches, ctx.allPlayersSet);
    const generalRankings = buildRankings(generalStatsMap, ctx.leagueConfig, liveMatches);
    const generalMatchStats = computeMatchStats(generalRankings, ctx.allPlayersSet.size);
    generalPanel.innerHTML = `
        <div class="dash-controls corr-controls">
            <div class="corr-controls-top">
                <label>League &mdash; all matches (${generalMatchStats.playedMatches}/${generalMatchStats.totalMatches})</label>
                <span class="corr-gaussian-stats"></span>
                <div class="corr-shift-group">
                    <button class="corr-gaussian-toggle" type="button" disabled title="Overlays a fitted normal (Gaussian) curve on this histogram, using this data's own mean and standard deviation &mdash; a visual reference only, not a claim that the data is actually normally distributed.">Gaussian fit</button>
                    <button class="corr-trim-toggle" type="button" disabled title="Zooms the X-axis in to the middle 99% of this league's matches (symmetric around 0), hiding the outlier bins beyond that. Display only &mdash; the Gaussian fit below always uses the full, untrimmed data.">Trim to 99%</button>
                    <div class="corr-shift-control" title="Adds this many PR points to every match's PR gap before recomputing the Gaussian fit below &mdash; use it to test whether the distribution's centre is off by a constant amount. 0 = the model's real, unshifted PR gaps.">
                        <button class="corr-shift-btn" data-dir="-1" aria-label="Decrease PR-gap shift" disabled>&minus;</button>
                        <span class="corr-shift-value">
                            <span class="corr-shift-caption">PR-gap shift</span>
                            <b class="corr-shift-amount">0</b>
                        </span>
                        <button class="corr-shift-btn" data-dir="1" aria-label="Increase PR-gap shift" disabled>+</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="predictor-info-popup corr-gaussian-popup" hidden></div>
        <div class="chart-host corr-host"></div>
    `;
    leagueContainer.appendChild(generalPanel);

    // All League Matches — density histogram across EVERY league of this
    // same league type ever played, below "League — all matches". The
    // cross-league fetch is async, so this panel is appended first
    // (reserving its slot) and filled in once loadVisibleLeagues() resolves,
    // below.
    const allTimePanel = document.createElement('div');
    allTimePanel.className = 'chart-panel corr-panel corr-panel--general';
    allTimePanel.innerHTML = `
        <div class="dash-controls corr-controls">
            <div class="corr-controls-top">
                <label class="corr-alltime-label">All League Matches &hellip;</label>
                <span class="corr-gaussian-stats"></span>
                <div class="corr-shift-group">
                    <button class="corr-gaussian-toggle" type="button" disabled title="Overlays a fitted normal (Gaussian) curve on this histogram, using this data's own mean and standard deviation &mdash; a visual reference only, not a claim that the data is actually normally distributed.">Gaussian fit</button>
                    <button class="corr-explanation-toggle" type="button" disabled title="Compares this row's real data against the win-probability table, gap by gap, with a likelihood check on how surprising each row's result is.">Model validation</button>
                    <button class="corr-trim-toggle" type="button" disabled title="Zooms the X-axis in to the middle 99% of all-time matches (symmetric around 0), hiding the outlier bins beyond that. Display only &mdash; the Gaussian fit and Model validation below always use the full, untrimmed data.">Trim to 99%</button>
                    <div class="corr-shift-control" title="Adds this many PR points to every match's PR gap before recomputing the Gaussian fit and Model validation table below &mdash; use it to test whether the model's calibration point is off by a constant amount. 0 = the model's real, unshifted PR gaps.">
                        <button class="corr-shift-btn" data-dir="-1" aria-label="Decrease PR-gap shift" disabled>&minus;</button>
                        <span class="corr-shift-value">
                            <span class="corr-shift-caption">PR-gap shift</span>
                            <b class="corr-shift-amount">0</b>
                        </span>
                        <button class="corr-shift-btn" data-dir="1" aria-label="Increase PR-gap shift" disabled>+</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="predictor-info-popup corr-gaussian-popup" hidden></div>
        <div class="predictor-info-popup corr-explanation-popup" hidden></div>
        <div class="chart-host corr-host"></div>
    `;
    leagueContainer.appendChild(allTimePanel);

    const generalGaussianToggle = generalPanel.querySelector('.corr-gaussian-toggle');
    const generalTrimToggle = generalPanel.querySelector('.corr-trim-toggle');
    const generalGaussianStatsEl = generalPanel.querySelector('.corr-gaussian-stats');
    const generalGaussianPopup = generalPanel.querySelector('.corr-gaussian-popup');
    const generalShiftAmountEl = generalPanel.querySelector('.corr-shift-amount');
    const [generalMinusBtn, generalPlusBtn] = generalPanel.querySelectorAll('.corr-shift-btn');
    let generalTrimmed = false;
    let generalShowGaussian = false;
    let generalShift = 0;

    function generalTrimmedBound() {
        const vals = generalSeries.map(m => Math.abs(m.advantage + generalShift)).sort((a, b) => a - b);
        if (!vals.length) return domain.xMax;
        const idx = Math.min(vals.length - 1, Math.floor(0.99 * vals.length));
        return Math.min(domain.xMax, Math.max(1, Math.ceil(vals[idx])));
    }

    function redrawGeneral() {
        generalShiftAmountEl.textContent = `${generalShift > 0 ? '+' : ''}${generalShift}`;

        const enoughForGaussian = generalSeries.length >= MIN_GAUSSIAN_N;
        generalGaussianToggle.disabled = !enoughForGaussian;
        generalGaussianToggle.textContent = enoughForGaussian ? 'Gaussian fit' : 'Gaussian fit (not enough data)';
        generalGaussianToggle.title = enoughForGaussian
            ? 'Overlays a fitted normal (Gaussian) curve on this histogram, using this data\'s own mean and standard deviation — a visual reference only, not a claim that the data is actually normally distributed.'
            : `Needs at least ${MIN_GAUSSIAN_N} played matches before a mean/standard deviation is meaningful.`;
        if (!enoughForGaussian) generalShowGaussian = false;
        generalGaussianToggle.classList.toggle('is-active', generalShowGaussian);

        generalTrimToggle.disabled = false;
        generalTrimToggle.textContent = generalTrimmed ? 'Show full range' : 'Trim to 99%';
        generalTrimToggle.classList.toggle('is-active', generalTrimmed);

        const bound = generalTrimmed ? generalTrimmedBound() : domain.xMax;
        const localXMin = -bound, localXMax = bound;
        const buckets = buildDensityBuckets(generalSeries, generalShift, localXMin, localXMax, generalTrimmed);

        let gaussian = null;
        if (generalShowGaussian) {
            const shiftedValues = generalSeries.map(m => m.advantage + generalShift);
            const { mean, std } = meanStd(shiftedValues);
            gaussian = { mean, std };
            generalGaussianStatsEl.textContent = `μ = ${mean.toFixed(2)}   σ = ${std.toFixed(2)}`;
            generalGaussianPopup.innerHTML = buildGaussianExplainerHtml(shiftedValues);
            generalGaussianPopup.hidden = false;
            wireDynamicLangPopup(generalGaussianPopup);
            generalGaussianPopup.querySelector('.corr-gaussian-popup-close').addEventListener('click', () => {
                generalShowGaussian = false;
                redrawGeneral();
            });
        } else {
            generalGaussianStatsEl.textContent = '';
            generalGaussianPopup.hidden = true;
            generalGaussianPopup.innerHTML = '';
        }

        drawHistogramRow(generalPanel.querySelector('.corr-host'), buckets, {
            xMin: localXMin,
            xMax: localXMax,
            showAxis: true,
            totalCount: generalSeries.length,
            gaussian
        });
    }
    redrawGeneral();

    generalGaussianToggle.addEventListener('click', () => { generalShowGaussian = !generalShowGaussian; redrawGeneral(); });
    generalTrimToggle.addEventListener('click', () => { generalTrimmed = !generalTrimmed; redrawGeneral(); });
    generalMinusBtn.disabled = false;
    generalPlusBtn.disabled = false;
    generalMinusBtn.addEventListener('click', () => { generalShift = Math.max(-10, generalShift - 1); redrawGeneral(); });
    generalPlusBtn.addEventListener('click', () => { generalShift = Math.min(10, generalShift + 1); redrawGeneral(); });

    function buildPanel(initialPlayer) {
        const panel = document.createElement('div');
        panel.className = 'chart-panel corr-panel';
        panel.innerHTML = `
            <div class="dash-controls corr-controls">
                <div class="corr-controls-top">
                    <label>Player:</label>
                    <select class="player-pick">${players.map(p => `<option value="${p}" ${p === initialPlayer ? 'selected' : ''}>${displayPlayerName(p)}</option>`).join('')}</select>
                    <span class="corr-games-count"></span>
                    <button class="remove-chart" title="Remove this chart">&times;</button>
                </div>
                <span class="corr-metric-pill corr-luck-pill"></span>
            </div>
            <div class="chart-host corr-host"></div>
        `;
        container.appendChild(panel);

        const playerSel = panel.querySelector('.player-pick');
        const gamesCount = panel.querySelector('.corr-games-count');
        const luckPill = panel.querySelector('.corr-luck-pill');
        const host = panel.querySelector('.corr-host');
        const removeBtn = panel.querySelector('.remove-chart');

        function redraw() {
            const player = playerSel.value;
            const series = buildPlayerAdvantageSeries(liveMatches, player);
            gamesCount.textContent = `(${series.length}/${players.length - 1} matches)`;
            const mlIdx = nearestMatchLengthIdx(ctx.params.MatchLength || 7);
            const items = series.map(m => ({
                pWin: getWinProbability(m.prSelf, m.prOpp, mlIdx),
                outcome: m.win ? 1 : 0
            }));
            applyLuckPill(luckPill, signedLuckScore(items));
            drawCorrelationRow(host, series.map(m => ({ x: m.advantage, win: m.win, match: m })), {
                xMin: playerDomain.xMin,
                xMax: playerDomain.xMax,
                showAxis: true,
                buildInfoHtml: (p) => corrMatchInfoHtml(p.match)
            });
        }

        const entry = { panel, playerSel, redraw };
        panels.push(entry);

        playerSel.addEventListener('change', redraw);
        removeBtn.addEventListener('click', () => {
            if (panels.length > 1) {
                panel.remove();
                panels.splice(panels.indexOf(entry), 1);
            }
        });

        redraw();
    }

    buildPanel(players[0]);

    const addBtn = document.getElementById('add-corr-chart');
    if (addBtn) {
        addBtn.addEventListener('click', () => buildPanel(players[0]));
    }

    // All-time cross-league data (async, may already be warm from other
    // pages via loadVisibleLeagues()'s own memoization). Populates the
    // All-League-Matches heatmap once resolved; expands the shared domain
    // and redraws every already-built row if all-time history has a larger
    // PR gap than this league alone, so everything stays aligned.
    let shift = 0;
    loadVisibleLeagues().then(leagues => {
        const leagueType = ctx.leagueConfig.type;
        // Same league type AND same match length (column in the PR
        // Win-Probability Table) — pooling different match lengths together
        // would mix matches whose win-probability model is genuinely
        // different (a bigger PR gap matters more over a longer match), so
        // it wouldn't be one consistent population to compare against a
        // single table column the way the Model-validation popup does.
        const typeLeagues = leagues.filter(l =>
            l.leagueType === leagueType &&
            nearestMatchLengthIdx(l.params.MatchLength || 7) === generalMlIdx
        );
        const rows = [];
        for (const league of typeLeagues) {
            for (const m of buildGeneralAdvantageSeries(league.matches)) {
                rows.push({ ...m, mlIdx: generalMlIdx });
            }
        }

        const labelEl = allTimePanel.querySelector('.corr-alltime-label');
        if (!rows.length) {
            labelEl.textContent = 'All League Matches — no data yet';
            return;
        }

        let allTimeMaxAbs = 0;
        for (const r of rows) allTimeMaxAbs = Math.max(allTimeMaxAbs, Math.abs(r.advantage));
        const expandedBound = Math.max(domain.xMax, Math.ceil(allTimeMaxAbs));
        const domainChanged = expandedBound > domain.xMax;
        if (domainChanged) {
            domain.xMin = -expandedBound;
            domain.xMax = expandedBound;
        }

        labelEl.textContent = `All League Matches (${rows.length} matches, ${typeLeagues.length} league${typeLeagues.length === 1 ? '' : 's'})`;
        const shiftAmountEl = allTimePanel.querySelector('.corr-shift-amount');
        const trimToggle = allTimePanel.querySelector('.corr-trim-toggle');
        const host = allTimePanel.querySelector('.corr-host');
        const [minusBtn, plusBtn] = allTimePanel.querySelectorAll('.corr-shift-btn');

        // Trim view is independent of the shared `domain` — toggling it only
        // narrows the X-axis (dropping outlier bins entirely, not folding
        // them into the edge) for THIS row's own display. The Gaussian fit
        // and Model validation table always recompute over the full,
        // untrimmed `rows` data below, so trimming never changes them.
        const fullBound = domain.xMax;
        let trimmed = false;

        const gaussianToggle = allTimePanel.querySelector('.corr-gaussian-toggle');
        const gaussianStatsEl = allTimePanel.querySelector('.corr-gaussian-stats');
        const gaussianPopup = allTimePanel.querySelector('.corr-gaussian-popup');
        let showGaussian = false;

        const explanationToggle = allTimePanel.querySelector('.corr-explanation-toggle');
        const explanationPopup = allTimePanel.querySelector('.corr-explanation-popup');
        let showExplanation = false;

        function trimmedBound() {
            const vals = rows.map(r => Math.abs(r.advantage + shift)).sort((a, b) => a - b);
            if (!vals.length) return fullBound;
            const idx = Math.min(vals.length - 1, Math.floor(0.99 * vals.length));
            return Math.min(fullBound, Math.max(1, Math.ceil(vals[idx])));
        }

        function redrawAllTime() {
            const bound = trimmed ? trimmedBound() : fullBound;
            const localXMin = -bound, localXMax = bound;
            const buckets = buildDensityBuckets(rows, shift, localXMin, localXMax, trimmed);
            shiftAmountEl.textContent = `${shift > 0 ? '+' : ''}${shift}`;
            trimToggle.textContent = trimmed ? 'Show full range' : 'Trim to 99%';
            trimToggle.classList.toggle('is-active', trimmed);

            const enoughForGaussian = rows.length >= MIN_GAUSSIAN_N;
            gaussianToggle.disabled = !enoughForGaussian;
            gaussianToggle.textContent = enoughForGaussian ? 'Gaussian fit' : 'Gaussian fit (not enough data)';
            gaussianToggle.title = enoughForGaussian
                ? 'Overlays a fitted normal (Gaussian) curve on this histogram, using this data\'s own mean and standard deviation — a visual reference only, not a claim that the data is actually normally distributed.'
                : `Needs at least ${MIN_GAUSSIAN_N} matches before a mean/standard deviation is meaningful.`;
            if (!enoughForGaussian) showGaussian = false;
            gaussianToggle.classList.toggle('is-active', showGaussian);

            let gaussian = null;
            if (showGaussian) {
                const shiftedValues = rows.map(r => r.advantage + shift);
                const { mean, std } = meanStd(shiftedValues);
                gaussian = { mean, std };
                gaussianStatsEl.textContent = `μ = ${mean.toFixed(2)}   σ = ${std.toFixed(2)}`;
                // Always compared against THIS league's own match length
                // (generalMlIdx), same as the plain-language ask: "what a
                // game at this league's length would predict" — even though
                // `rows` itself pools matches of every match length across
                // leagues.
                gaussianPopup.innerHTML = buildGaussianExplainerHtml(shiftedValues);
                gaussianPopup.hidden = false;
                wireDynamicLangPopup(gaussianPopup);
                gaussianPopup.querySelector('.corr-gaussian-popup-close').addEventListener('click', () => {
                    showGaussian = false;
                    redrawAllTime();
                });
            } else {
                gaussianStatsEl.textContent = '';
                gaussianPopup.hidden = true;
                gaussianPopup.innerHTML = '';
            }

            explanationToggle.disabled = !enoughForGaussian;
            explanationToggle.textContent = enoughForGaussian ? 'Model validation' : 'Model validation (not enough data)';
            explanationToggle.title = enoughForGaussian
                ? 'Compares this row\'s real data against the win-probability table, gap by gap, with a likelihood check on how surprising each row\'s result is.'
                : `Needs at least ${MIN_GAUSSIAN_N} matches before this comparison is meaningful.`;
            if (!enoughForGaussian) showExplanation = false;
            explanationToggle.classList.toggle('is-active', showExplanation);

            if (showExplanation) {
                // Always compared against THIS league's own match length
                // (generalMlIdx), same as the Gaussian popup: "what a game
                // at this league's length would predict" — even though
                // `rows` itself pools matches of every match length across
                // leagues.
                explanationPopup.innerHTML = buildExplanationTableHtml(rows, shift, generalMlIdx);
                explanationPopup.hidden = false;
                wireDynamicLangPopup(explanationPopup);
                explanationPopup.querySelector('.corr-explanation-popup-close').addEventListener('click', () => {
                    showExplanation = false;
                    redrawAllTime();
                });
            } else {
                explanationPopup.hidden = true;
                explanationPopup.innerHTML = '';
            }

            drawHistogramRow(host, buckets, {
                xMin: localXMin,
                xMax: localXMax,
                showAxis: true,
                totalCount: rows.length,
                gaussian
            });
        }

        minusBtn.disabled = false;
        plusBtn.disabled = false;
        minusBtn.addEventListener('click', () => { shift = Math.max(-10, shift - 1); redrawAllTime(); });
        plusBtn.addEventListener('click', () => { shift = Math.min(10, shift + 1); redrawAllTime(); });
        trimToggle.disabled = false;
        trimToggle.addEventListener('click', () => { trimmed = !trimmed; redrawAllTime(); });
        gaussianToggle.disabled = false;
        gaussianToggle.addEventListener('click', () => { showGaussian = !showGaussian; redrawAllTime(); });
        explanationToggle.disabled = false;
        explanationToggle.addEventListener('click', () => { showExplanation = !showExplanation; redrawAllTime(); });
        redrawAllTime();

        if (domainChanged) {
            redrawGeneral();
        }
    });
}
