/**
 * dashboardPage.js — League Dashboard (Phase F).
 * F1: summary cards (with leader flag)
 * F2: historical view — defaults to current state showing medal winners only
 * F3: rounds navigator — all matches incl. unplayed, with "played on" column
 * F4: player picker + interactive bar chart, with multi-chart compare
 * Plus: prev/next league navigation arrows in the header.
 */

import { loadLeagueParams, loadLeagueOrder, loadOverrides, loadAllLeagueParams, loadLeagueMatchesAll, loadMatchHistory, applyOverrides, loadLeagueProjections } from '../data/store.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { getMatchesAsOf, getUpdatePoints, buildMatchTimeline, mergeHistoryIntoMatches, matchKey, resultSides, describeResult, formatAxisDay, INITIAL_POINT } from '../compute/matchHistory.js';
import { computeAllStats } from '../compute/stats.js';
import { rankLeague, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { elapsedInWindow, durationMode } from '../compute/leagueDuration.js';
import { buildPrizeRows, formatPrize, getMedalPlaces } from '../compute/prizeRows.js';
import { getQueryParam, formatPercent, formatNumber, leagueTableUrl, playerLeagueUrl, leagueUrl, flagUrl, getFlagCode, thLabel } from '../utils/helpers.js';
import { exportWhatsAppTableImage, MAX_EXPORT_ROWS, leagueTypeLabel } from '../utils/exportTableImage.js';
import { colorForValue, colorForValueInverted, colorForConfidence } from '../compute/colorScale.js';
import { drawPlayerBarChart, computeNiceRange } from './playerBarChart.js';
import { drawCorrelationRow, drawHistogramRow } from './prCorrelationChart.js';
import { luckConfidenceFromItems } from '../compute/luckConfidence.js';
import { applyLuckPill } from './luckPill.js';
import { renderBreadcrumbs } from './navigation.js';
import { predictChampionship, computeTopXPct, prProbabilityTableHtml, getWinProbability, nearestMatchLengthIdx, matchLengthForIdx } from '../compute/championshipPredictor.js';
import { pmTableHtml } from '../../table-lab/formats/pm/mount.js';
import { getPopup, leagueTypePill } from '../data/popupContent.js';
import { tableValidationExampleHistogramSvg } from './exampleHistograms.js';
import { batchLast300PRForSimulator, loadVisibleLeagues } from '../compute/crossLeague.js';
import { loadPlayersMetadata } from '../data/store.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { langFlagsHtml, wireLangPopup, wireDynamicLangPopup } from '../utils/popupLang.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { pinStickyCols } from '../utils/stickyCols.js';
import { startSplash, splashStage, endSplash } from '../utils/splash.js';
import { renderErrorScreen, explainError, inlineErrorHtml } from '../utils/errorScreen.js';
import { buildLeagueHeaderData, renderV16Header, formatLastUpdatedDate } from './leagueHeader.js';
import { mountAppTabs } from './appTabs.js';
import { TAB_ICONS } from './tabIcons.js';
import { wireSectionCollapse } from './sectionCollapse.js';
import { mountAccordionTabs, mountLengthSelector } from './subTabs.js';
import { displayPlayerName, alternateName } from '../utils/nameDisplay.js';
import { mountSearchField, mountCombobox, playerIdentityHtml } from '../utils/combobox.js';
import { primeTitleMeta, titleHtmlFor } from '../utils/playerTitleBadge.js';
import { mountTopXTimelineChart, colorForIndex } from './topXTimelineChart.js';
import { projectAt, TIMELINE_ITERATIONS, scheduleFingerprint, pointFingerprints, withInitialPoint } from '../compute/topXTimeline.js';
import { createLeagueLuckSource } from '../utils/playerLuckBadge.js';
import { formatMatchStamp, formatMatchDay } from '../utils/matchTime.js';

export async function renderDashboardPage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');
    if (!leagueId) {
        renderErrorScreen(container, {
            title: 'No league selected',
            message: 'This dashboard needs a league in its address. Pick one from the list.',
            actions: [{ label: 'Browse leagues', href: 'index.html', primary: true }]
        });
        return;
    }

    startSplash();
    try {
        // Each promise reports its own stage as it lands, so the splash
        // narrates real progress rather than one opaque Promise.all.
        const [params, overrides, history, leagueOrder, playersMeta, matchesAllData] = await Promise.all([
            loadLeagueParams(leagueId).then(r => { splashStage('settings'); return r; }),
            loadOverrides(leagueId),
            loadMatchHistory(leagueId),
            loadLeagueOrder().catch(() => []),
            loadPlayersMetadata().then(r => { splashStage('players'); return r; }),
            loadLeagueMatchesAll(leagueId).then(r => { splashStage('matches'); return r; })
        ]);
        const lastModified = params.LastUpdated || null;

        // Per-type navigation requires params of all leagues
        const folderNamesAll = (leagueOrder || []).map(t => t.replace(' - ', ' '));
        let allParams = [];
        try {
            allParams = await loadAllLeagueParams(folderNamesAll);
        } catch { allParams = []; }

        const title = leagueId; // always the full league name (id), never the short LeagueTitle
        document.title = `${title} — Dashboard`;

        // V16 hero banner header (production default for the dashboard).
        renderV16Header(
            document.getElementById('page-title'),
            buildLeagueHeaderData(params, lastModified, leagueId),
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

        splashStage('ranking');

        // Apply manual overrides (consistency with league table)
        const playedMatches = applyOverrides(playedMatchesRaw, overrides);
        const allMatchesIncUnplayed = applyOverridesToAll(allMatchesIncUnplayedRaw, overrides);

        const leagueConfig = getLeagueConfig(params);
        // ONE timeline drives B5's rows and dates, the Historical (B2) and What-If
        // (B4) update points, the as-of replay behind both, and the live merge —
        // so a match is offered as a point exactly when it is shown as a played
        // match, and a not-played override erases both together.
        const timeline = buildMatchTimeline(history, overrides, allMatchesIncUnplayed);
        const liveMatches = mergeHistoryIntoMatches(playedMatches, timeline);

        const ctx = {
            leagueId, params, leagueConfig, lastModified,
            allMatchesIncUnplayed, playedMatches, liveMatches, allPlayersSet,
            roundCount,
            // `timeline`, not the raw history: nothing downstream should be able
            // to reach a row the timeline deliberately excludes.
            timeline, playersMeta
        };

        // Summary cards live just under the header (outside the tabs), matching
        // the landing page's hero → info-cards → tabs composition.
        splashStage('render');
        container.innerHTML = '';
        const cardsHost = document.createElement('div');
        cardsHost.className = 'dashboard-cards';
        cardsHost.id = 'dash-cards';
        container.appendChild(cardsHost);

        // Progressive-disclosure tabs (same chrome as HOME via mountAppTabs).
        const shell = mountAppTabs({
            tabs: [
                { id: 'standings', label: 'Standings', icon: TAB_ICONS.standings },
                { id: 'matches',   label: 'Matches',   icon: TAB_ICONS.matches },
                { id: 'predictor', label: 'Predictor', icon: TAB_ICONS.predictor },
                { id: 'charts',    label: 'Charts',    icon: TAB_ICONS.charts }
            ],
            urlKey: 'tab',
            // Retired 2026-08 (?tab=insights opened a tab labelled "Charts").
            aliases: { insights: 'charts' },
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
        shell.panels.charts.innerHTML    = insightsPanel(leagueConfig.showPR);

        renderSummaryCards(ctx);
        renderPrizes(ctx);
        renderHistorical(ctx);
        renderPredictor(ctx); // async — fills in after data loads
        renderWhatIfSimulator(ctx);
        renderTitleRace(ctx); // async — projects the whole timeline in a worker
        renderPlayedMatches(ctx);
        renderRounds(ctx);
        renderRemainingMatches(ctx);
        renderPlayerSection(ctx);
        renderPrCorrelationSection(ctx);
    } catch (err) {
        console.error(err);
        renderErrorScreen(container, { ...explainError(err, { leagueId }), error: err });
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
                <div class="snap-nav">
                    <button id="hist-prev" title="Previous snapshot">&lsaquo;</button>
                    <input type="text" id="hist-date" class="app-search-input snap-select" autocomplete="off" title="Select the match to rewind to">
                    <button id="hist-next" title="Next snapshot">&rsaquo;</button>
                </div>
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

// Bilingual "?" popup body from the single source (js/data/popupContent.js),
// so a text edit there updates both the site and the Explanation & Maths tool.
function popupLangBlocks(id) {
    const p = getPopup(id);
    return `
                <div class="popup-lang-en" data-lang="en">${p.render('en')}</div>
                <div class="popup-lang-he" data-lang="he">${p.render('he')}</div>`;
}

function predictorPanel() {
    return `
        <section class="app-section app-section--card dash-section" id="predictor-section">
            <h2 class="app-section-h2">Championship Predictor
                <span class="predictor-tooltip" id="predictor-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="predictor-info-popup" hidden>
                <button class="predictor-info-close" id="predictor-info-close">&times;</button>
                <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                ${popupLangBlocks('predictor')}
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
                    ${popupLangBlocks('whatif')}
                </div>
                <div id="whatif-body">
                    <div class="whatif-baseline dash-controls" id="whatif-baseline-row" hidden>
                        <label for="whatif-baseline-select">Run from</label>
                        <div class="snap-nav">
                            <button id="whatif-baseline-prev" type="button" title="Newer snapshot">&lsaquo;</button>
                            <input type="text" id="whatif-baseline-select" class="app-search-input snap-select" autocomplete="off" title="Historical version to run the simulation from">
                            <button id="whatif-baseline-next" type="button" title="Older snapshot">&rsaquo;</button>
                        </div>
                    </div>
                    <div class="whatif-picker">
                        <div class="whatif-combo">
                            <input type="text" id="whatif-input-a" class="whatif-input app-search-input" placeholder="Player A" autocomplete="off">
                        </div>
                        <span class="whatif-vs">vs</span>
                        <div class="whatif-combo">
                            <input type="text" id="whatif-input-b" class="whatif-input app-search-input" placeholder="Player B" autocomplete="off">
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
                        <div class="whatif-ribbon" id="whatif-ribbon">SIMULATION &mdash; based on your what-if scenario</div>
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

        <section class="app-section app-section--card dash-section" id="titlerace-section">
            <h2 class="app-section-h2">Title Race</h2>
            <div id="titlerace-body">
                <div class="dash-controls titlerace-controls">
                    <div class="predictor-topx-control">
                        <label for="titlerace-topx">Show</label>
                        <select id="titlerace-topx" class="topx-select"></select>
                    </div>
                    <input type="text" id="titlerace-player" class="app-search-input titlerace-add" placeholder="Add a player" autocomplete="off">
                </div>
                <div id="titlerace-legend" class="titlerace-legend"></div>
                <div id="titlerace-chart" class="chart-host"></div>
                <!-- Step the pinned point one MATCH at a time. The chart answers a
                     tap anywhere on its width, which on a phone means ~2px per
                     point on a 300-match league: picking a specific match by
                     finger is not realistic, and neither is nudging one over.
                     Same stepper chrome as the Rounds and Run-from controls. -->
                <div class="dash-controls titlerace-step">
                    <button id="titlerace-prev" type="button" title="Previous match">&lsaquo;</button>
                    <span class="round-label" id="titlerace-pos">&nbsp;</span>
                    <button id="titlerace-next" type="button" title="Next match">&rsaquo;</button>
                </div>
            </div>
        </section>
    `;
}

// ---------- Title Race (B4b) ----------
/**
 * Every player's odds of finishing in the top X, at every point of the season.
 *
 * The Predictor answers that question for today; this asks it again for every
 * match ever recorded, so the answer becomes a shape. The X axis IS the update
 * timeline (one step = one match), which is what lets the panel under the chart
 * name the match that moved a line — the same timeline the Historical and
 * What-If pickers offer, so all three agree about what a point in this league is.
 *
 * The whole season is ~90 Monte Carlo projections. That runs in a Worker
 * (js/compute/topXTimelineWorker.js) and streams back oldest-point-first, so the
 * page stays interactive and the lines grow while it works. A browser that
 * cannot start the Worker falls back to the same pure module on the main thread,
 * one point per animation frame — slower and jerkier, never frozen and never
 * missing.
 */
async function renderTitleRace(ctx) {
    const section = document.getElementById('titlerace-section');
    const chartHost = document.getElementById('titlerace-chart');
    const legendHost = document.getElementById('titlerace-legend');
    const topXSelect = document.getElementById('titlerace-topx');
    const playerInput = document.getElementById('titlerace-player');
    if (!section || !chartHost) return;

    // Every Title Race control logs through this one helper, exactly as What If
    // does. Targets share the `Title race: ` family so analyticsPage.js can give
    // the whole section its 🏎️-paired icons; the specific prefixes MUST stay
    // listed above the generic entry there.
    const trackRace = (target) => {
        window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target } }));
    };

    // OPEN by default, like the Predictor it sits under.
    //
    // It shipped collapsed for one reason: opening it meant ~90 Monte Carlo
    // projections in the visitor's browser, and hiding that behind a click kept
    // the cost off everyone who did not ask for it. That reason is gone - the
    // projections are precomputed and the section now costs one query and no
    // CPU at all - so the click it used to charge for is just a click.
    //
    // The toggle is still logged, in both directions: with the section open,
    // COLLAPSING it is now the interesting signal (people shutting it away),
    // where before the signal was anyone opening it.
    wireSectionCollapse(section, {
        defaultOpen: true,
        onToggle: (open) => trackRace(`Title race: section ${open ? 'expanded' : 'collapsed'}`),
    });

    // Oldest → newest: a timeline is read left to right.
    const points = withInitialPoint([...getUpdatePoints(ctx.timeline, ctx.params.RetiredPlayers)].reverse());
    // points[0] is always INITIAL, so a league with no played match has length 1
    // and nothing to plot. A FINISHED league is not less interesting than a
    // running one: the race is over, but how it was won is what this section is
    // for.
    if (points.length < 3) { section.remove(); return; }

    const flags = ctx.params.CustomFlags;
    const identity = (name) => playerIdentityHtml({
        name: displayPlayerName(name),
        flagCode: getFlagCode(name, flags),
        titleHtml: titleHtmlFor(name),
    });

    // Per-point display data. `dayLabel` is the axis text — date only, no clock:
    // see the axis renderer for why.
    // TWO labels from one date, because the axis and the panel answer differently.
    //
    // The X AXIS carries no clock - ever, for anything. That is why every point
    // goes through `formatAxisDay`, and the league's opening date is not an
    // exception to it: it went through `formatIssueDate` (which delegates to
    // formatMatchStamp and appends the time) and printed "1 Sept 2026, 00:00"
    // on an axis whose other labels read "5 Sept".
    //
    // The PANEL is the opposite case and keeps the full stamp, exactly as it
    // does for every match.
    const startLabel = formatIssueDate(ctx.params.IssueDate) || '';
    const startAxis = formatAxisDay(ctx.params.IssueDate) || '';
    const viewPoints = points.map((p) => {
        // INITIAL: the league before anything was played. No match, so no score
        // and nobody on the board — the panel says what it is instead.
        if (!p.match) {
            return {
                value: p.value,
                dateLabel: startLabel ? `Initial, ${startLabel}` : 'Initial',
                dayLabel: startAxis,
                players: [],
                scoreLabel: '—',
                resultHtml: '<span class="tr-verb">Before the first match</span>',
            };
        }
        const { winner, loser, drawn } = resultSides(p.match);
        const hi = Math.max(Number(p.match.scoreA), Number(p.match.scoreB));
        const lo = Math.min(Number(p.match.scoreA), Number(p.match.scoreB));
        return {
            value: p.value,
            dateLabel: p.dateLabel,
            dayLabel: formatAxisDay(p.match.updatedAt),
            // Who was on the board at this point — the chart rings the marker on
            // a player's own line only where they actually played.
            players: [p.match.playerA, p.match.playerB],
            scoreLabel: Number.isFinite(hi) && Number.isFinite(lo) ? `${hi} – ${lo}` : '—',
            resultHtml: `${identity(winner)} <span class="tr-verb">${drawn ? 'draws' : 'beats'}</span> ${identity(loser)}`,
        };
    });

    // Everyone's running W–L–D at every point. A straight count over the same
    // timeline the chart is drawn on — no simulation, so it costs nothing and is
    // available immediately, including for the points still being projected.
    //
    // It answers a different question from the percentage beside it: the odds say
    // what was still POSSIBLE, the record says what had already HAPPENED. A line
    // at 12% is a different story when its owner is 9–1 with three games left
    // than when they are 2–8, and without the record the panel cannot tell them
    // apart.
    const records = buildRecordsByPoint(points);

    // topXByPoint[i] = { player -> Float32Array of cumulative top-X percentages }
    const topXByPoint = new Array(points.length).fill(null);
    let playerCount = 0;
    let currentX = 1;
    const plotted = [];   // player names, in the order they were added

    const seriesFor = () => plotted.map((player, i) => ({
        player,
        color: colorForIndex(i),
        identityHtml: identity(player),
        record: records.get(player) || null,
        values: topXByPoint.map((row) => {
            if (!row || !row[player]) return null;
            return row[player][Math.min(currentX, row[player].length) - 1];
        }),
    }));

    const model = () => ({
        points: viewPoints,
        series: seriesFor(),
        topX: currentX,
        pending: topXByPoint.filter(r => r == null).length,
    });

    const chart = mountTopXTimelineChart(chartHost, {
        model,
        // Which MOMENT of the season someone chose to inspect - the one thing
        // this section is for, and until now the only interaction it did not
        // report. The point names the match, which is what makes the row
        // readable in the analytics table without a lookup.
        onPick: (i) => {
            syncStepper();
            const p = i >= 0 ? viewPoints[i] : null;
            if (!p) { trackRace('Title race: point cleared'); return; }
            const m = points[i] && points[i].match;
            trackRace(`Title race: point — ${m ? describeResult(m) : 'Initial'}`);
        },
    });

    // ‹ › — one MATCH per press.
    //
    // The canvas already answers a tap, but it maps the whole plot width onto
    // every point: on a 430px phone a 300-match league gives each point about
    // 1.3px, so choosing a particular match by finger is not a thing anyone can
    // do, and nudging one across is worse. These buttons make the axis
    // navigable by pressing rather than by aiming.
    const stepPrev = document.getElementById('titlerace-prev');
    const stepNext = document.getElementById('titlerace-next');
    const stepPos = document.getElementById('titlerace-pos');

    // Move the stepper INSIDE the chart host, between the canvas and the detail
    // panel, so it sits directly under the X axis.
    //
    // It cannot be authored there: mountTopXTimelineChart clears the host and
    // appends canvas + panel itself, so anything placed there in the markup is
    // wiped. Declared after the host and relocated once, here.
    //
    // Why it matters: the panel grows with the number of plotted players - five
    // players is a title line plus five rows - and with the stepper below it the
    // buttons ended up a screen away from the axis they scrub. The control
    // belongs against the thing it moves.
    const chartPanel = chartHost.querySelector('.chart-info-panel');
    const stepBar = stepPrev.closest('.titlerace-step');
    if (chartPanel && stepBar) chartHost.insertBefore(stepBar, chartPanel);

    /** Readout + end-stops, from whatever the chart currently has pinned. */
    function syncStepper() {
        const i = chart.getPinned();
        const total = points.length;
        stepPos.textContent = i < 0 ? 'Tap a point' : `${i + 1} / ${total}`;
        stepPrev.disabled = i === 0;
        stepNext.disabled = i >= 0 && i === total - 1;
    }

    /**
     * Nothing pinned yet? Start at the NEWEST point rather than at index 0 -
     * that is the league as it stands, the state every other panel is showing,
     * so the first press lands somewhere the reader already understands instead
     * of at the empty INITIAL column.
     */
    const step = (delta) => {
        const cur = chart.getPinned();
        const next = cur < 0 ? points.length - 1 : cur + delta;
        const landed = chart.setPinned(next);
        syncStepper();
        const m = points[landed] && points[landed].match;
        // A STEP IS ITS OWN EVENT, and its own DIRECTION.
        //
        // Not folded into the tap's `point — ` for two reasons. The stepper was
        // built on a specific claim - that the axis cannot be navigated by finger
        // on a phone - and one event for both would make that claim permanently
        // unmeasurable. And direction is the thing this control is FOR: walking
        // back through a season and walking forward through it are different
        // readings, and the icons (⬅️ / ➡️) say which at a glance.
        //
        // The match is still named, exactly as the tap names it, so "which
        // moments get looked at" survives across both.
        trackRace(`Title race: step ${delta < 0 ? 'back' : 'forward'} — ${m ? describeResult(m) : 'Initial'}`);
    };
    stepPrev.addEventListener('click', () => step(-1));
    stepNext.addEventListener('click', () => step(1));
    syncStepper();

    function renderLegend() {
        if (plotted.length === 0) {
            legendHost.innerHTML = '<span class="tr-legend-empty">No players plotted — add one to start.</span>';
            return;
        }
        legendHost.innerHTML = plotted.map((p, i) => `
            <span class="tr-chip" data-player="${escapeHtml(p)}">
                <span class="tr-swatch" style="background:${colorForIndex(i)}"></span>
                ${identity(p)}
                <button class="tr-chip-x" type="button" data-remove="${escapeHtml(p)}" title="Remove ${escapeHtml(displayPlayerName(p))}">&times;</button>
            </span>`).join('');
    }

    legendHost.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove]');
        if (!btn) return;
        const i = plotted.indexOf(btn.dataset.remove);
        if (i >= 0) {
            plotted.splice(i, 1);
            renderLegend();
            chart.draw();
            trackRace(`Title race: remove ${btn.dataset.remove}`);
        }
    });

    // The Show control mirrors the Predictor's, so "Top 3" means the same thing
    // in both places. Switching it costs nothing: the worker returns the whole
    // cumulative row per player, so every X is already computed.
    function fillTopXOptions(n) {
        topXSelect.innerHTML = '';
        for (let x = 1; x <= n; x++) {
            const opt = document.createElement('option');
            opt.value = x;
            opt.textContent = x === 1 ? '1st place only' : x === n ? `Top ${x} (any finish)` : `Top ${x}`;
            topXSelect.appendChild(opt);
        }
        topXSelect.value = String(Math.min(currentX, n));
    }
    fillTopXOptions(Math.max(1, ctx.allPlayersSet.size - 1));
    topXSelect.addEventListener('change', () => {
        currentX = parseInt(topXSelect.value, 10) || 1;
        chart.draw();
        trackRace(`Title race: top ${currentX}`);
    });

    // Add-a-player: the canonical search field, same as every other picker.
    const rosterNames = [...ctx.allPlayersSet].filter(p => p !== 'Bye').sort((a, b) => a.localeCompare(b));
    primeTitleMeta();
    mountSearchField(playerInput, {
        getOptions: () => rosterNames.map(p => ({ value: p, label: displayPlayerName(p) })),
        labelFor: (v) => displayPlayerName(v),
        altFor: (v) => alternateName(v),
        decorate: (v) => ({
            flagCode: getFlagCode(v, flags),
            titleHtml: titleHtmlFor(v),
            // Listed but unpickable once plotted — the row still explains why,
            // which a silently-missing name would not.
            disabled: plotted.includes(v),
            badge: plotted.includes(v) ? { text: 'PLOTTED', kind: 'staged' } : null,
        }),
        onPick: (v) => {
            if (!plotted.includes(v)) {
                plotted.push(v);
                renderLegend();
                chart.draw();
                trackRace(`Title race: add ${v}`);
            }
            playerInput.value = '';
        },
    });

    /**
     * WHO IS PLOTTED BY DEFAULT: everyone who was ever a real contender, up to
     * five of them.
     *
     * "Ever" is the operative word. The podium as it stands today is the END of
     * the story, and this chart is about the story: the player who sat at 60%
     * halfway through and collapsed is the most interesting line on it, and
     * finishing fourth is exactly why picking today's top three would leave him
     * off. So the test is the PEAK - did this player's chance of winning ever
     * clear 15%.
     *
     * More than five clear it in a long season, and five lines is already the
     * limit of what the eye can follow, so the survivors are ranked by where
     * they stand NOW and the weakest are dropped. Fewer than five is fine and
     * common: two-horse races exist and should look like one.
     *
     * @param {number} threshold  percent, 15 = "ever had a 15% chance to win"
     */
    function contenders(threshold = 15, max = 5) {
        const peak = new Map();
        const latest = new Map();
        for (const row of topXByPoint) {
            if (!row) continue;
            for (const [player, vals] of Object.entries(row)) {
                const winPct = vals[0];              // index 0 is top-1
                if (!(winPct >= 0)) continue;
                peak.set(player, Math.max(peak.get(player) ?? 0, winPct));
                latest.set(player, winPct);          // last write wins = newest point
            }
        }
        const qualified = [...peak.entries()]
            .filter(([p, v]) => p !== 'Bye' && v > threshold)
            .map(([p]) => p)
            .sort((a, b) => (latest.get(b) ?? 0) - (latest.get(a) ?? 0));
        return qualified.slice(0, max);
    }

    /**
     * The fallback seed: today's podium.
     *
     * Used when there are no projections to read yet, because "who was ever a
     * contender" is not answerable until the numbers exist - and seeding from
     * the podium and then swapping the lines out once they arrive would be a
     * chart that rearranges itself under the reader's hand.
     */
    function seedFromPodium() {
        const { rankings } = rankLeague({ matches: ctx.liveMatches, allPlayers: ctx.allPlayersSet, config: ctx.leagueConfig });
        for (const r of rankings.filter(r => r.player !== 'Bye').slice(0, 3)) plotted.push(r.player);
    }

    function seedPlotted() {
        if (plotted.length) return;
        const picked = contenders();
        // Nobody ever cleared the bar - a league so lopsided that one player was
        // never in doubt, or so young that nobody has separated yet. An empty
        // chart is not an answer, so the current leader carries it alone.
        if (picked.length) plotted.push(...picked);
        else seedFromPodium();
        renderLegend();
    }

    // ── Stored projections first ────────────────────────────────────────────
    // The whole league is normally precomputed server-side at full accuracy
    // (sql/league_projections.sql + scripts/project-title-race.js). Reading it
    // is one query and no CPU at all, which is the entire point: the fallback
    // below exists for the gap before a league has been projected, not as the
    // normal path.
    //
    // Staleness is decided PER POINT, by recomputing each point's input
    // fingerprint here and comparing it with the stored one. That keeps "out of
    // date" a property of the data rather than a guess about whether a
    // background job is running — an edit at match 30 of 250 leaves points 1–29
    // live and flags only what actually changed.
    await whenVisible(section);

    const scheduleFp = scheduleFingerprint(ctx.allMatchesIncUnplayed, fingerprintSettings(ctx));
    const expectedHashes = pointFingerprints(points.map(p => p.match), scheduleFp);
    let staleCount = 0;

    const stored = await loadLeagueProjections(ctx.leagueId);
    if (stored && Array.isArray(stored.points) && stored.points.length) {
        const byHash = new Map(stored.points.map(sp => [sp.hash, sp]));
        for (let i = 0; i < points.length; i++) {
            const sp = byHash.get(expectedHashes[i]);
            if (!sp) { staleCount++; continue; }   // missing OR superseded
            const row = {};
            stored.roster.forEach((player, pos) => {
                const arr = sp.r[pos];
                if (arr && arr.length) row[player] = Float32Array.from(arr, v => v / 10);
            });
            topXByPoint[i] = row;
        }
        if (!playerCount && stored.roster.length) fillTopXOptions(stored.roster.length);
        seedPlotted();
        chart.draw();
        // Everything present and current — no local computation at all.
        if (staleCount === 0) return;
        console.info(`[title race] ${staleCount}/${points.length} points not yet projected — computing those locally`);
    }

    // Computing locally: the contender test has nothing to read yet, so the
    // podium seeds the chart and stays - see seedFromPodium.
    if (!plotted.length) { seedFromPodium(); renderLegend(); }

    const last300Map = await ensureLast300Map(ctx);

    const onPoint = (index, topX, n) => {
        topXByPoint[index] = topX;
        if (!playerCount) { playerCount = n; fillTopXOptions(n); }
        chart.draw();
    };

    const payload = {
        timeline: ctx.timeline,
        allMatchesIncUnplayed: ctx.allMatchesIncUnplayed,
        allPlayers: [...ctx.allPlayersSet],
        matchLength: ctx.params.MatchLength || 7,
        leagueConfig: ctx.leagueConfig,
        last300Map: [...last300Map.entries()],
        iterations: TIMELINE_ITERATIONS,
        points: points.map(p => p.value),
    };

    try {
        const worker = new Worker(new URL('../compute/topXTimelineWorker.js', import.meta.url), { type: 'module' });
        const runId = 1;
        worker.onmessage = (e) => {
            const m = e.data;
            if (!m || m.runId !== runId) return;
            if (m.type === 'point') onPoint(m.index, m.topX, m.n);
            else if (m.type === 'done' || m.type === 'error') worker.terminate();
            if (m.type === 'error') console.error('Title race projection failed:', m.message);
        };
        worker.onerror = () => { worker.terminate(); projectOnMainThread(); };
        worker.postMessage({ type: 'run', runId, ...payload });
    } catch {
        projectOnMainThread();
    }

    // Fallback: one point per animation frame. Each projection is ~90 ms, so
    // this drops frames — but the page keeps responding between them and the
    // chart still fills, which a single blocking loop would not.
    function projectOnMainThread() {
        let i = 0;
        const step = () => {
            if (i >= points.length) return;
            const point = projectAt({
                timeline: ctx.timeline,
                allMatchesIncUnplayed: ctx.allMatchesIncUnplayed,
                pointValue: points[i].value,
                allPlayers: ctx.allPlayersSet,
                matchLength: payload.matchLength,
                leagueConfig: ctx.leagueConfig,
                last300Map,
                iterations: TIMELINE_ITERATIONS,
            });
            const topX = {};
            for (const [player, idx] of Object.entries(point.idxByPlayer)) {
                const row = new Float32Array(point.n);
                for (let x = 1; x <= point.n; x++) row[x - 1] = computeTopXPct(point.finishRankCounts, idx, point.n, point.totalWeight, x);
                topX[player] = row;
            }
            onPoint(i, topX, point.n);
            i++;
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
}

/**
 * Cumulative W–L–D per player, at every point of the timeline.
 *
 * @param {object[]} points  getUpdatePoints() reversed — OLDEST FIRST, which is
 *                           what makes this a single forward pass.
 * @returns {Map<string, {w:Int16Array, l:Int16Array, d:Int16Array}>}
 *          index i = that player's record AFTER the match at point i.
 *
 * A player is written into the map the first time they appear, so every index
 * before that stays 0 — correct, because they had played nothing yet. Every
 * KNOWN player is stamped at every subsequent index, so a lookup is O(1) and a
 * player who sat out a stretch keeps their record across it rather than
 * reporting a gap.
 *
 * `resultSides` is the same reader the picker and the panel headline use, so a
 * technical draw counts as a draw here exactly as it reads there.
 */
function buildRecordsByPoint(points) {
    const n = points.length;
    const out = new Map();
    const running = new Map();
    const ensure = (p) => {
        let r = out.get(p);
        if (!r) {
            r = { w: new Int16Array(n), l: new Int16Array(n), d: new Int16Array(n) };
            out.set(p, r);
        }
        return r;
    };
    for (let i = 0; i < n; i++) {
        // INITIAL carries no match: everyone is 0-0, which is what the arrays
        // already hold at index 0. Stamping the (empty) running map is still
        // correct and keeps the loop uniform.
        const m = points[i].match;
        if (m) {
            const { winner, loser, drawn } = resultSides(m);
            for (const p of [winner, loser]) if (!running.has(p)) running.set(p, { w: 0, l: 0, d: 0 });
            if (drawn) { running.get(winner).d++; running.get(loser).d++; }
            else { running.get(winner).w++; running.get(loser).l++; }
        }
        for (const [p, c] of running) {
            const r = ensure(p);
            r.w[i] = c.w; r.l[i] = c.l; r.d[i] = c.d;
        }
    }
    return out;
}

function matchesPanel() {
    return `
        <section class="app-section app-section--card dash-section">
            <h2 class="app-section-h2">Played Matches</h2>
            <div id="played-matches-table"></div>
        </section>

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

// showPR gates the two PR-based correlation sections: REGULAR leagues record no
// PR, so only the Player-match-history charts (Luck metric) are shown for them.
function insightsPanel(showPR) {
    return `
        <section class="app-section app-section--card dash-section">
            <h2 class="app-section-h2">Player match history</h2>
            <div id="charts-container"></div>
            <button id="add-chart" class="add-chart-btn" title="Add another chart for comparison" data-track="Compare: add player chart">+ Add chart</button>
        </section>
        ${showPR ? `
        <section class="app-section app-section--card dash-section" id="pr-corr-section">
            <h2 class="app-section-h2">Player PR difference &harr; Result &harr; Luck
                <span class="predictor-tooltip" id="pr-corr-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="pr-corr-info-popup" hidden>
                <button class="predictor-info-close" id="pr-corr-info-close">&times;</button>
                <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                ${popupLangBlocks('pr-corr')}
            </div>
            <div id="corr-container"></div>
            <button id="add-corr-chart" class="add-chart-btn" title="Add another player's correlation row" data-track="Compare: add player chart">+ Add player chart</button>
        </section>

        <section class="app-section app-section--card dash-section" id="league-corr-section">
            <h2 class="app-section-h2">League PR difference &harr; Result
                <span class="predictor-tooltip" id="league-corr-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="league-corr-info-popup" hidden>
                <button class="predictor-info-close" id="league-corr-info-close">&times;</button>
                <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                ${popupLangBlocks('league-corr')}
            </div>
            <div id="corr-league-container">
        </section>
        ` : ''}
    `;
}

// ---------- F1 ----------
function renderSummaryCards(ctx) {
    const { params, liveMatches, allPlayersSet, leagueConfig } = ctx;
    const { statsMap, rankings } = rankLeague({ matches: liveMatches, allPlayers: allPlayersSet, config: leagueConfig });
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
        { label: 'League Progress', value: leagueProgressHtml(params, matchStats), cls: 'dash-card--progress' }
    ];
    if (leagueConfig.showPR) cards.push({ label: 'Average PR', value: avgPR });
    cards.push({ label: 'Leading Player', value: leaderHtml, flex: true });

    const cardsHost = document.getElementById('dash-cards');
    cardsHost.innerHTML = cards.map(c => `
        <div class="dash-card${c.flex ? ' dash-card--flex' : ''}${c.cls ? ` ${c.cls}` : ''}">
            <div class="dash-card-label">${c.label}</div>
            <div class="dash-card-value">${c.value}</div>
        </div>
    `).join('');
    attachPlayerNameInteractions(cardsHost, ctx.leagueId);
}

/* ---------- F1: League Progress card ----------
   Two progress readings side by side: how much of the SCHEDULE has been played,
   and how much of the league's CALENDAR has passed. Read together they answer
   the only question the old "Games Played" count couldn't: is the league on
   time? */

// A league is behind schedule once the calendar has moved this much further
// than the games have (0.10 = ten percentage points). Below it the two readings
// are effectively in step (a single missing match on a small league is a few
// points on its own), so anything inside the band — and anything AHEAD of the
// calendar — is green.
const PROGRESS_GAP_TOLERANCE = 0.10;

/**
 * Games + calendar progress for the League Progress card.
 *
 * `days` is null whenever there is no window to measure against — the league
 * runs with no time limit, or it has no issue date to count from. The caller
 * then shows the games reading ALONE rather than inventing an end date; see
 * js/compute/leagueDuration.js, which owns what a league's window is.
 */
function computeLeagueProgress(params, matchStats) {
    const total = matchStats.totalMatches;
    // Both readings are fractions of 1, so they are directly comparable and both
    // print through the site's own formatPercent (two decimals, as everywhere
    // else a percentage appears here).
    const games = {
        played: matchStats.playedMatches,
        total,
        pct: total > 0 ? matchStats.playedMatches / total : 0,
    };

    const window = elapsedInWindow(params);
    const days = window
        ? { ...window, pct: window.total > 0 ? window.elapsed / window.total : 0 }
        : null;

    // Behind = the calendar has run further than the games have. Ahead needs no
    // warning, so the comparison is one-sided.
    const behind = days ? days.pct - games.pct > PROGRESS_GAP_TOLERANCE : false;
    return { games, days, behind };
}

/**
 * "17.75", "0.99", "31" — a day count carries its fraction, but never a bare
 * ".00". Truncated rather than rounded: at 23:59 of a one-day league 0.9993
 * must not print as "1 / 1" beside "99.93%", which would read as a finished
 * league that somehow isn't.
 */
function formatDayCount(days) {
    return formatNumber(Math.floor(days * 100) / 100, 2).replace(/\.?0+$/, '');
}

function progressRowHtml(label, value, pct, title) {
    const width = Math.min(Math.max(pct, 0), 1) * 100;
    return `
        <div class="dash-prog-row" title="${escapeHtml(title)}">
            <div class="dash-prog-head">
                <span class="dash-prog-name">${escapeHtml(label)}</span>
                <span class="dash-prog-value">${escapeHtml(value)}</span>
                <span class="dash-prog-pct">${formatPercent(pct)}</span>
            </div>
            <div class="dash-prog-track"><span class="dash-prog-fill" style="width:${width.toFixed(2)}%"></span></div>
        </div>`;
}

function leagueProgressHtml(params, matchStats) {
    const { games, days, behind } = computeLeagueProgress(params, matchStats);
    const state = behind ? 'is-behind' : 'is-on-track';
    const rows = [
        progressRowHtml('Games', `${games.played} / ${games.total}`, games.pct,
            `${games.played} of ${games.total} scheduled matches played`),
    ];
    if (days) {
        // The bar is continuous, so the count beside it is too — "17.75 / 31"
        // is the figure the percentage was actually computed from. The tooltip
        // carries the human framing ("day 18 of 31"), which is the calendar day
        // currently in progress rather than the days completed.
        const dayInProgress = Math.min(Math.floor(days.elapsed) + 1, days.total);
        const where = `Day ${dayInProgress} of ${days.total}`;
        rows.push(progressRowHtml('Days', `${formatDayCount(days.elapsed)} / ${days.total}`, days.pct,
            behind
                ? `${where} — the schedule is behind the calendar`
                : `${where} — the schedule is keeping up with the calendar`));
    } else if (durationMode(params) === 'unlimited') {
        // Say WHY there's no Days bar. A league that runs open-endedly is never
        // "behind the calendar" — there is no calendar to be behind — and a
        // silently missing second bar reads as missing data instead of as the
        // deliberate setting it is.
        rows.push(`<div class="dash-prog-note" title="This league has no end date, so there is no time progress to show">No time limit</div>`);
    }
    return `<div class="dash-progress ${state}">${rows.join('')}</div>`;
}

// Measures the rendered width of sticky col-1 and writes --col1-w on the wrapper
// so sticky col-2's left: var(--col1-w) aligns correctly (iron rule 12).
// The measuring, the loop guard and the observer all live in stickyCols.js.
function measureScrollWrapStickyCols(wrap) {
    if (!wrap) return;
    pinStickyCols(wrap.querySelector('table'), '--col1-w', { target: wrap });
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
    // A tier can award more than one prize level (see prizeRows.js); those arrive
    // as further rows under the same medal, in the same four columns.
    const rows = buildPrizeRows(params);

    let html = `<div class="prizes-info"><span class="prizes-entry">Entry Fee: <b>₪${entryFee}</b></span></div>`;
    html += '<div class="prizes-table-wrap"><table class="dash-table prizes-table font-small" data-mf-table-id="B1"><thead><tr><th scope="col"></th><th scope="col">Tier</th><th scope="col">Places</th><th scope="col">Prize</th></tr></thead><tbody>';
    for (const r of rows) {
        html += `<tr class="prize-row-${r.tier.toLowerCase()}${r.isExtra ? ' prize-row-extra' : ''}"><td>${r.icon}</td><td>${r.tier}</td><td>${r.count}</td><td>${formatPrize(r.prize)}</td></tr>`;
    }
    html += '</tbody></table></div>';
    content.innerHTML = html;

    // Prizes & Medals is collapsible, closed by default (shared section collapse).
    wireSectionCollapse(section, { defaultOpen: false });
}

// ---------- F2 ----------
function renderHistorical(ctx) {
    const { timeline, lastModified, leagueId } = ctx;
    const input = document.getElementById('hist-date');
    const prevBtn = document.getElementById('hist-prev');
    const nextBtn = document.getElementById('hist-next');
    const fullLink = document.getElementById('hist-to-full');

    const options = buildSnapshotOptions(timeline, lastModified, ctx.params);

    // The "Open full table" button follows the selected snapshot: for Current it
    // opens the live league table; for a historical point it carries ?asof= so
    // table D rebuilds that snapshot, and its label flags the historical state.
    function syncFullLink(value, label) {
        if (value === '__current__') {
            fullLink.href = leagueTableUrl(leagueId);
            fullLink.textContent = 'Open full table ›';
            fullLink.title = 'Open the full league table for the current state';
            // Distinct analytics target: this navigates to the league TABLE, unlike
            // a landing league-card (also an <a href ?league=>, which the generic
            // listener logs as "League link:"). data-track wins over that branch,
            // so the two reads apart even though both land on the same league.
            fullLink.dataset.track = `Full table: ${leagueId}`;
        } else {
            fullLink.href = `${leagueTableUrl(leagueId)}&asof=${encodeURIComponent(value)}`;
            fullLink.textContent = 'Open full historical table ›';
            fullLink.title = `Open the full league table as of ${label} (historical version)`;
            fullLink.dataset.track = `Full table: ${leagueId} (historical)`;
        }
    }

    // First paint is silent (mountSnapshotPicker selects index 0 without firing
    // onChange), so the initial render happens here and only USER-driven changes
    // are logged.
    mountSnapshotPicker({
        input, prevBtn, nextBtn, options, params: ctx.params,
        onChange: (o) => {
            syncFullLink(o.value, o.label);
            drawHistTable(ctx, o.value);
            window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target: `History view: ${o.label}` } }));
        },
    });
    syncFullLink(options[0].value, options[0].label);
    drawHistTable(ctx, options[0].value);
}

/** A real instant — reads in the viewer's own timezone. */
function formatLastModified(s) {
    return formatMatchStamp(s);
}

// Snapshot dropdown options shared by the Historical view (B2) and the What-If
// baseline picker (B4): "Current (…)" first, then every historical update point
// newest → oldest, and always "Initial" last. `__current__` is the sentinel for
// the live/latest state.
//
// Initial is the league before a single match was played. It is not an update
// point (nothing was updated yet) and there is no row in match_history that
// could represent it — the oldest real point is the FIRST batch of results,
// which for a league imported in one go is already the finished league. Without
// this entry the empty league is simply unreachable, so every league gets it,
// synthesised, at the bottom of the list where it belongs chronologically.
function buildSnapshotOptions(timeline, lastModified, params) {
    const points = getUpdatePoints(timeline, params.RetiredPlayers);
    const options = [];

    // CURRENT IS THE NEWEST MATCH — one row, not two.
    //
    // The live state is the state after the last match played, so "Current" and
    // the newest update point describe the same thing. They used to be listed
    // separately and read as duplicates, because each carried a different clock:
    // Current was stamped with the LEAGUE's last-updated (a settings edit moves
    // it), the point with the match's own recording time. So the newest point IS
    // the Current row: it keeps the `__current__` value (picking it renders the
    // live table) and takes the match's own date, like every other row, with a
    // CURRENT badge as the only thing that sets it apart.
    //
    // A league with no history at all still gets a plain Current entry — there is
    // no match to name.
    if (points.length) {
        const newest = points.shift();
        options.push({ ...newest, value: '__current__', current: true, label: `Current · ${newest.label}` });
    } else {
        options.push({ value: '__current__', label: lastModified ? `Current (${formatLastModified(lastModified)})` : 'Current' });
    }

    // The whole point object travels — `match` and `dateLabel` are what let the
    // picker render the row as the match it is, not as a bare clock reading.
    for (const p of points) options.push(p);
    const started = params && params.IssueDate ? formatIssueDate(params.IssueDate) : '';
    options.push({
        value: INITIAL_POINT,
        label: started ? `Initial, ${started} — no matches played` : 'Initial — no matches played',
    });
    return options;
}

/**
 * A stored projection point, rebuilt into the shape `predictChampionship`
 * returns - `finishRankCounts`, `n`, `totalWeight`, `rankings`, `moe`,
 * `iterations` - so callers cannot tell the difference and nothing downstream
 * needed to change.
 *
 * The counts are RECONSTRUCTED from the stored cumulative top-X row: entry x is
 * "finished in the top x", so the count at rank x is the gap between
 * consecutive entries, scaled by an arbitrary total.
 *
 * @param {string} pointValue  '__current__' for the newest point, or a point value
 * @param {Map} statsMap       the standings AS OF that point (MP/W/L/PR columns)
 * @returns {object|null} null means "simulate instead" - see the guards inside
 */
async function storedPointPrediction(ctx, pointValue, remaining, statsMap = null) {
    const points = withInitialPoint([...getUpdatePoints(ctx.timeline, ctx.params.RetiredPlayers)].reverse());
    if (points.length < 2) return null;

    const scheduleFp = scheduleFingerprint(ctx.allMatchesIncUnplayed, fingerprintSettings(ctx));
    const hashes = pointFingerprints(points.map(p => p.match), scheduleFp);

    const isCurrent = !pointValue || pointValue === '__current__';
    const idx = isCurrent ? points.length - 1 : points.findIndex(p => p.value === pointValue);
    if (idx < 0) return null;

    // THE GUARD THAT MATTERS, and it only applies to the live state: the stored
    // point is built from `match_history`, while the Predictor's table is built
    // from `matches`. Those are normally 1:1 but are not guaranteed to be -
    // December 2025 carries 24 history rows for a retired player against 3
    // fixtures. Where they disagree, the stored numbers are a correct answer to
    // a DIFFERENT question, and showing them is worse than spending the CPU.
    //
    // A PAST point needs no such check: its played set is defined by
    // getMatchesAsOf, which is the same list the stored point was built from.
    if (isCurrent) {
        const asOf = getMatchesAsOf(ctx.timeline, points[idx].value);
        const played = new Set(ctx.liveMatches.map(m => matchKey(m.playerA, m.playerB)));
        if (asOf.length !== played.size) return null;
        for (const m of asOf) if (!played.has(matchKey(m.playerA, m.playerB))) return null;
    }

    const stored = await loadLeagueProjections(ctx.leagueId);
    if (!stored || !Array.isArray(stored.points)) return null;
    const sp = stored.points.find(x => x.hash === hashes[idx]);
    if (!sp) return null;   // never projected, or superseded by a later edit

    const roster = stored.roster || [];
    const n = roster.length;
    if (!n) return null;

    const TOTAL = 1_000_000;   // arbitrary scale; percentages are what was stored
    const finishRankCounts = new Float64Array(n * n);
    roster.forEach((player, i) => {
        const row = sp.r[i];
        if (!row || !row.length) return;
        let prev = 0;
        for (let x = 0; x < Math.min(row.length, n); x++) {
            const cum = row[x] / 10;                    // stored as pct x10
            finishRankCounts[i * n + x] = Math.max(0, cum - prev) / 100 * TOTAL;
            prev = cum;
        }
    });

    const stats = statsMap || computeAllStats(ctx.liveMatches, ctx.allPlayersSet);
    const rankings = roster.map((player, i) => {
        const st = stats.get(player);
        const row = sp.r[i];
        return {
            player, playerIdx: i,
            championshipPct: row && row.length ? row[0] / 10 : 0,
            games: st ? st.games : 0,
            wins: st ? st.wins : 0,
            losses: st ? st.losses : 0,
            meanPR: st ? st.meanPR : null,
            winRate: st ? st.winRate : null,
            points: st ? (st.points || 0) : 0,
            avgPoints: st ? st.avgPoints : null,
        };
    }).sort((a, b) => b.championshipPct - a.championshipPct);

    // MoE from the iterations ACTUALLY used, read off the row. A hard-coded
    // number here would let a league projected under an older setting claim an
    // accuracy it does not have.
    const iterations = stored.iterations || 0;
    const p = (rankings[0] ? rankings[0].championshipPct : 0) / 100;
    const moe = iterations > 0 ? 1.96 * Math.sqrt(p * (1 - p) / iterations) * 100 : 0;

    return {
        rankings, moe, iterations,
        method: (remaining && remaining.length > 0) ? 'montecarlo' : 'exact',
        finishRankCounts, n, totalWeight: TOTAL,
    };
}

/**
 * The league settings that are an input to EVERY projected point, in the shape
 * scheduleFingerprint wants. Read from ctx here and from the `leagues` row in
 * the Node job — both must produce the same three values or every stored point
 * reads as stale.
 */
function fingerprintSettings(ctx) {
    return {
        matchLength: ctx.params.MatchLength || 7,
        leagueType: ctx.leagueConfig && ctx.leagueConfig.type,
        retiredPlayers: ctx.params.RetiredPlayers || [],
    };
}

/**
 * "1 Jul 2026" — the league's issue date, for the Initial option's label.
 *
 * An issue date is a DAY, never a moment: the same reading for every viewer,
 * and no clock — a league does not open at an hour.
 *
 * The `T00:00:00` pin this used to apply was the old way of saying "no time" —
 * it forced LOCAL midnight so the label would not read "03:00", which held for
 * a viewer in Israel and slid a day for one west of Greenwich. matchTime.js
 * renders a day without converting it at all.
 */
function formatIssueDate(d) {
    return formatMatchDay(d, '');
}

function drawHistTable(ctx, dateValue) {
    const { timeline, allPlayersSet, leagueConfig, liveMatches, params } = ctx;

    let matchesForView;
    if (dateValue === '__current__') {
        matchesForView = liveMatches;
    } else {
        // dateValue is now an exact update-point timestamp (see getUpdatePoints)
        matchesForView = getMatchesAsOf(timeline, dateValue);
    }

    const { statsMap, rankings } = rankLeague({ matches: matchesForView, allPlayers: allPlayersSet, config: leagueConfig });

    // Places per tier INCLUDING the tier's extra prize rows, so B2 both TINTS
    // and SIZES itself off the same podium B1 describes — an added prize row
    // lengthens this table by exactly the places it awards.
    const { gold: goldCount, silver: silverCount, bronze: bronzeCount } =
        getMedalPlaces(params, { gold: 1, silver: 1, bronze: 4 });
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

/**
 * Resolve once `el` is actually on screen — used to keep work off the load path.
 *
 * An IntersectionObserver rather than a hook on mountAppTabs: a hidden tab
 * panel does not intersect, so this covers being switched to by a click, by a
 * keyboard shortcut, by Back, and by landing directly on ?tab=… , without
 * teaching the tab component about any particular panel's cost. Resolves
 * immediately when the element is already visible.
 *
 * Falls back to resolving straight away where IntersectionObserver is missing:
 * the point is to defer work, never to lose it.
 */
function whenVisible(el) {
    if (!el || typeof IntersectionObserver === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { io.disconnect(); resolve(); }
        });
        io.observe(el);
    });
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
        const { rankings } = rankLeague({
            matches: ctx.liveMatches, allPlayers: ctx.allPlayersSet, config: ctx.leagueConfig
        });
        const top = rankings[0];
        moeHost.textContent = '';
        host.innerHTML = `<div style="text-align:center;color:var(--color-text-muted);padding:var(--space-md)">Season complete — ${top ? top.player : 'N/A'} wins the championship.</div>`;
        return;
    }

    // ── Do not simulate until the Predictor tab is actually open ────────────
    // predictChampionship() is a Monte Carlo run with a floor of 50 000
    // iterations (see estimateIterations' STEP pin), and it is a SYNCHRONOUS
    // CPU loop — being inside an async function buys nothing, because once it
    // starts it owns the main thread until it finishes. Profiling a warm
    // navigation into this page put 76% of a 5 s transition inside this one
    // call tree (simulateMonteCarlo + gaussianLUT + getWinProbability), all of
    // it for a panel behind the third of four tabs that most visits never open.
    //
    // Waiting for the panel to be visible costs nothing when it IS the tab
    // being opened, and removes the whole cost from every visit that isn't.
    // Nothing about the simulation itself changes — same iterations, same
    // accuracy — it simply stops running before the page it is not part of.
    host.innerHTML = '<div class="loading">Computing projection…</div>';
    await whenVisible(section);

    try {
        const statsMap = computeAllStats(ctx.liveMatches, ctx.allPlayersSet);
        const matchLength = ctx.params.MatchLength || 7;

        // Load Last 300 PR (async — may take a moment). Cached on ctx for reuse by the What-If simulator.
        const last300Map = await ensureLast300Map(ctx);

        // THE PREDICTOR IS THE LAST POINT OF THE TITLE RACE.
        //
        // Both answer the same question - given what has been played, who wins?
        // - and the newest point on the timeline IS "what has been played". So
        // the projection job has already computed this table, at full accuracy,
        // and computing it again in the visitor's browser buys nothing but a
        // frozen tab and a slightly different random answer.
        //
        // Reading it also makes the two AGREE. They are separate Monte Carlo
        // runs today, so the chart's last column and this table can differ by a
        // point or two for no reason a reader could ever explain.
        const result = await storedPointPrediction(ctx, '__current__', remaining, statsMap)
            || predictChampionship({
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
        console.error(err);
        host.innerHTML = inlineErrorHtml("The championship prediction couldn't be calculated", err);
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
    const addBtn = document.getElementById('whatif-add');
    const addErr = document.getElementById('whatif-add-err');
    const stagedHost = document.getElementById('whatif-staged');
    const runBtn = document.getElementById('whatif-run');
    const clearBtn = document.getElementById('whatif-clear');
    const output = document.getElementById('whatif-output');
    const moeHost = document.getElementById('whatif-moe');
    const tableHost = document.getElementById('whatif-table');
    const expandBtn = document.getElementById('whatif-expand');
    const baselineRow = document.getElementById('whatif-baseline-row');
    const baselineSelect = document.getElementById('whatif-baseline-select');
    const baselinePrev = document.getElementById('whatif-baseline-prev');
    const baselineNext = document.getElementById('whatif-baseline-next');

    // Every What-If control logs through this one helper. `shabi:interaction`
    // (not a `data-track` attribute) because most of these carry a value only
    // known at click time, and several must log conditionally — a `data-track`
    // left on the element would fire again on a later no-op click.
    // Targets share the `What if: ` family so analyticsPage.js can give the
    // whole section the 🧪-paired icons; see CLICK_TYPE_ICONS there, where the
    // specific prefixes MUST stay listed above the generic `What if: ` entry.
    const trackWhatIf = (target) => {
        window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target } }));
    };

    // Collapse toggle (shared section header)
    wireSectionCollapse(section, {
        defaultOpen: true,
        infoBtn,
        onToggle: (open) => trackWhatIf(`What if: section ${open ? 'expanded' : 'collapsed'}`),
    });

    // Info popup. The "?" click itself is already logged generically as
    // `Info: What If` (js/analytics.js names it from the section heading), so
    // only the language choice needs wiring here.
    wireLangPopup(section, {
        btn: infoBtn,
        popup: infoPopup,
        close: infoClose,
        onLangPick: (lang) => trackWhatIf(`What if: help language — ${lang}`),
    });

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

    // Sort by the DISPLAYED name, not the raw username key: in "full name"
    // display mode displayPlayerName(p) differs from p, so a plain .sort() on
    // the key left the dropdown looking unsorted. localeCompare orders Hebrew
    // and Latin names correctly alphabetically.
    const byDisplayName = (a, b) => displayPlayerName(a).localeCompare(displayPlayerName(b));
    const allPlayersSorted = [...opponentsOf.keys()].filter(p => p !== 'Bye').sort(byDisplayName);

    // Both pickers run on the ONE canonical search field (mountSearchField):
    // touch/desktop separation, the mobile sheet + permanent Clear, flags and
    // result pills all come from the base. Flags resolve from THIS league's
    // CustomFlags (→ IL fallback via getFlagCode).
    const whatifCustomFlags = ctx.params?.CustomFlags || {};
    // Title badges (G0/WC/NC …) for the pickers — one canonical source, cached.
    primeTitleMeta();

    // ── The A/B pair — ONE picker configuration, mounted twice ──────────────
    // "A vs B" is a pair, not a primary field and a secondary one, so neither
    // side gets to be the smarter half. Each picker reads the OTHER field: fill
    // either one first and the remaining field narrows to that player's real
    // opponents, tags each with the real result, and greys out pairs already in
    // the scenario. Filling B first used to leave A listing the entire league
    // with no tags at all — every guard still fired, but only as a rejection
    // after the pick ("No scheduled match between these players") instead of a
    // row you could see was unavailable before choosing it.
    //
    // The badge always describes the ALREADY-CHOSEN player's real result against
    // the candidate in the row: WON means the player already in the other field
    // beat this one. That reading holds in both directions because `other` is
    // always the fixed side and `p` always the candidate.
    // What the two fields currently hold, as USERNAMES. The fields themselves
    // show the DISPLAY name (a full name when "Show name as" is set to it), so
    // the visible text is not a key: `opponentsOf`, `findSchedule`, `canonKey`
    // and the staged rows are all keyed by username. Picking writes the label to
    // the field and the username here; typing by hand clears it, so a
    // half-finished name can never be mistaken for a selection.
    const picked = { a: '', b: '' };
    // Resolve free text (someone typed a name instead of picking it) to a
    // username, accepting either form so both what the field shows and what the
    // data is keyed by are valid to type.
    const resolveTyped = (text) => {
        const q = text.trim().toLowerCase();
        if (!q) return '';
        return allPlayersSorted.find(p => p.toLowerCase() === q
            || displayPlayerName(p).toLowerCase() === q
            || (alternateName(p, ctx.playersMeta[p]) || '').toLowerCase() === q) || '';
    };

    // A row in the dropdown that is not a player: "stage every fixture this
    // player has left". It lives IN the list rather than beside it as a button,
    // because it belongs to the same decision - the list already shows exactly
    // these opponents, each tagged NOT PLAYED, and this is "all of those".
    const ALL_UNPLAYED = '__all_unplayed__';

    const pairPicker = (otherInput) => {
        const other = () => (otherInput === inputA ? picked.a : picked.b)
            || resolveTyped(otherInput.value);
        const played = (p) => {
            const o = other();
            return o ? deriveBaselineState(o, p).wasPlayed : false;
        };
        // `staged` is the live array below, so this re-evaluates on every
        // dropdown open: remove the row and the pair becomes pickable again with
        // its real-result badge back.
        const isStaged = (p) => {
            const o = other();
            return !!o && staged.some(s => s.key === canonKey(o, p));
        };
        return {
            labelFor: (p) => (p === ALL_UNPLAYED ? 'Add all not played' : displayPlayerName(p)),
            altFor: (p) => (p === ALL_UNPLAYED ? '' : alternateName(p, ctx.playersMeta[p])),
            suggest: (query) => {
                const o = other();
                const base = (o && opponentsOf.has(o))
                    ? [...opponentsOf.get(o)].filter(p => p !== 'Bye' && p !== o)
                    : allPlayersSorted.slice();
                const q = query.trim().toLowerCase();
                // Matched by BOTH names, exactly as the base filter would — this
                // list is custom only because it depends on the other field.
                const pool = q
                    ? base.filter(p => p.toLowerCase().includes(q)
                        || displayPlayerName(p).toLowerCase().includes(q)
                        || (alternateName(p, ctx.playersMeta[p]) || '').toLowerCase().includes(q))
                    : base;
                // Already-staged pairs sink below everything else — they can't be
                // picked, so they belong out of the way of the ones that can.
                const sorted = pool
                    .map(p => ({ p, staged: isStaged(p) ? 1 : 0, played: played(p) ? 1 : 0 }))
                    .sort((x, y) => (x.staged - y.staged) || (x.played - y.played) || byDisplayName(x.p, y.p))
                    .map(e => e.p);
                // The bulk row leads the list, and only when it would do
                // something: one side chosen, and at least one fixture of theirs
                // still unplayed and unstaged. It survives typing 'all' so it is
                // reachable by keyboard, not only by browsing.
                const bulk = unplayedOpponents(o);
                const wantsBulk = !q || 'all'.startsWith(q) || 'all not played'.includes(q);
                return (bulk.length && wantsBulk) ? [ALL_UNPLAYED, ...sorted] : sorted;
            },
            decorate: (p) => {
                if (p === ALL_UNPLAYED) {
                    const n = unplayedOpponents(other()).length;
                    // No flag and no title: this row is an ACTION, not a person,
                    // and borrowing a player's chrome would read as one. The
                    // count carries the same pill the individual rows use for
                    // NOT PLAYED, so the row says what it will stage.
                    return {
                        nameHtml: '<span class="whatif-bulk-name">Add all not played</span>',
                        badge: { text: `${n} ${n === 1 ? 'MATCH' : 'MATCHES'}`, kind: 'unplayed' },
                    };
                }
                const flagCode = getFlagCode(p, whatifCustomFlags);
                const titleHtml = titleHtmlFor(p);
                const o = other();
                if (!o) return { flagCode, titleHtml };
                // ADDED out-ranks every result badge: once the match is staged,
                // its real outcome is no longer the actionable fact about this
                // opponent — "you already have this one" is. The row stays listed
                // (so the user can see where it went) but is unpickable.
                if (isStaged(p)) {
                    return {
                        flagCode, titleHtml, disabled: true,
                        badge: { text: 'ADDED', kind: 'staged' },
                    };
                }
                const st = deriveBaselineState(o, p);
                if (!st.wasPlayed) return { flagCode, titleHtml, badge: { text: 'NOT PLAYED', kind: 'unplayed' } };
                const kind = st.realWinner === 'A' ? 'won' : st.realWinner === 'B' ? 'lost' : 'drew';
                const text = kind === 'won' ? 'WON' : kind === 'lost' ? 'LOST' : 'DREW';
                return { flagCode, titleHtml, badge: { text, kind } };
            },
            // The name STAYS in the field until "Add match" is pressed, so the
            // field keeps the picked player's flag + titles rather than degrading
            // to text.
            identity: true,
        };
    };

    // The two mounts differ only in which side they are: the field they read,
    // the slot they write, and the analytics label.
    const mountSide = (input, side, otherInput) => {
        const combo = mountSearchField(input, {
            ...pairPicker(otherInput),
            // Entering the field empties it so the list browses the whole roster;
            // leaving without picking puts the name back. Owned by the base.
            browseOnOpen: true,
            onPick: (p) => {
                if (p === ALL_UNPLAYED) { addAllUnplayed(otherOf(side)); input.value = ''; return; }
                picked[side] = p;
                // The field shows the name the row showed — the full name when
                // "Show name as" asks for it. It used to snap back to the
                // username on pick, which read as the choice having silently
                // changed.
                input.value = displayPlayerName(p);
                trackWhatIf(`What if: player ${side.toUpperCase()} — ${p}`);
            },
            // Typing by hand invalidates the pick; addMatch falls back to
            // resolving whatever was typed.
            onChange: () => { picked[side] = ''; },
        });
        return combo;
    };
    const comboA = mountSide(inputA, 'a', inputB);
    const comboB = mountSide(inputB, 'b', inputA);

    // State: staged matches
    const staged = []; // { a, b, key, result: 'NP'|'A'|'B', realWinner: 'A'|'B'|null, wasPlayed: bool }

    // Persist the "Show" (Top X) selection across re-runs of the simulation
    let lastTopX = 1;

    // ── Historical baseline ────────────────────────────────────────────
    // The simulation normally starts from the live/latest league state. The
    // "Run from" picker lets the user rewind that starting point to any saved
    // update-point (same snapshots as the Historical view / B2). computeBaseline
    // returns the played matches AND the still-unplayed fixtures as of the chosen
    // point; the staged what-if overrides are then applied on top when running.
    function computeBaseline(value) {
        if (!value || value === '__current__') {
            const played = [...ctx.liveMatches];
            const remaining = ctx.allMatchesIncUnplayed.filter(m => !m.played).slice();
            return { value: '__current__', played, remaining, playedByKey: indexByKey(played) };
        }
        const played = getMatchesAsOf(ctx.timeline, value); // played as of this point
        const playedKeys = new Set(played.map(m => canonKey(m.playerA, m.playerB)));
        // Every scheduled fixture not yet played at this point becomes a remaining
        // (unplayed) match, regardless of whether it has since been played.
        const remaining = ctx.allMatchesIncUnplayed
            .filter(m => !playedKeys.has(canonKey(m.playerA, m.playerB)))
            .map(m => ({ ...m, played: false, scoreA: null, scoreB: null, prA: null, prB: null, luckA: null, luckB: null }));
        return { value, played, remaining, playedByKey: indexByKey(played) };
    }

    function indexByKey(matches) {
        const map = new Map();
        for (const m of matches) map.set(canonKey(m.playerA, m.playerB), m);
        return map;
    }

    // Played-state + real winner of a fixture AT THE CURRENT BASELINE, resolved
    // relative to the user-entered A/B order. Used for the PLAYED/UNPLAYED badge
    // and the initial forced result of a newly staged match.
    function deriveBaselineState(a, b) {
        const bm = baseline.playedByKey.get(canonKey(a, b));
        const wasPlayed = !!bm && bm.scoreA != null && bm.scoreB != null;
        let realWinner = null;
        if (wasPlayed && !bm._draw && bm.scoreA !== bm.scoreB) {
            const aWon = bm.scoreA > bm.scoreB;
            realWinner = (aWon === (bm.playerA === a)) ? 'A' : 'B';
        }
        return { wasPlayed, realWinner };
    }

    let baseline = computeBaseline('__current__');

    // Populate the picker with the same snapshots as the Historical view; hide
    // the whole row when there's nothing to rewind to (no history yet).
    const baselineOptions = buildSnapshotOptions(ctx.timeline, ctx.lastModified, ctx.params);
    if (baselineOptions.length > 1) {
        baselineRow.hidden = false;
        mountSnapshotPicker({
            input: baselineSelect, prevBtn: baselinePrev, nextBtn: baselineNext,
            options: baselineOptions, params: ctx.params,
            onChange: (o) => {
                baseline = computeBaseline(o.value);
                // Keep the user's chosen results, but refresh each staged row's
                // played-state against the new baseline (badges + rollback warning).
                for (const s of staged) {
                    const st = deriveBaselineState(s.a, s.b);
                    s.wasPlayed = st.wasPlayed;
                    s.realWinner = st.realWinner;
                }
                renderStaged();
                runSimulation(); // the shown result is stale — recompute from the new baseline
                window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target: `What if baseline: ${o.label}` } }));
            },
        });
    }

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
        // Usernames, not what the fields display — see `picked` above.
        const a = picked.a || resolveTyped(inputA.value);
        const b = picked.b || resolveTyped(inputB.value);
        if (!a || !b) { addErr.textContent = 'Pick both players'; return; }
        if (a === b) { addErr.textContent = 'Cannot pair a player with themselves'; return; }
        if (!opponentsOf.has(a) || !opponentsOf.has(b)) { addErr.textContent = 'Unknown player'; return; }
        const sched = findSchedule(a, b);
        if (!sched) { addErr.textContent = 'No scheduled match between these players'; return; }
        const key = canonKey(a, b);
        if (staged.some(s => s.key === key)) { addErr.textContent = 'Match already added'; return; }

        // Played-state + real result are read from the selected baseline (which
        // may be an earlier snapshot), not the always-current schedule.
        const { wasPlayed, realWinner } = deriveBaselineState(a, b);

        staged.push({
            a, b, key,
            result: realWinner || 'NP',
            realWinner,
            wasPlayed
        });

        // Logged only once the pair actually staged — every `return` above is a
        // rejected click that would otherwise record a match that never existed.
        trackWhatIf(`What if: add match — ${a} vs ${b}`);

        inputA.value = '';
        inputB.value = '';
        picked.a = '';
        picked.b = '';
        // Clearing the text programmatically fires no `input` event, so the
        // fields' identity chrome has to be dropped explicitly — otherwise the
        // previous pair's flags would sit beside two empty fields.
        comboA.setIdentity('');
        comboB.setIdentity('');
        renderStaged();
    }

    /** The player in the OTHER field, by side. */
    function otherOf(side) {
        return side === 'a'
            ? (picked.b || resolveTyped(inputB.value))
            : (picked.a || resolveTyped(inputA.value));
    }

    /**
     * Everyone `player` still has a scheduled fixture against that has not been
     * played AT THE CURRENT BASELINE and is not already staged.
     *
     * Deliberately the same three tests the individual rows already apply - the
     * schedule, `deriveBaselineState`, and `staged` - so the bulk row can never
     * offer a set that differs from the NOT PLAYED rows sitting under it.
     */
    function unplayedOpponents(player) {
        if (!player || !opponentsOf.has(player)) return [];
        return [...opponentsOf.get(player)]
            .filter(p => p !== 'Bye' && p !== player)
            .filter(p => !staged.some(x => x.key === canonKey(player, p)))
            .filter(p => !deriveBaselineState(player, p).wasPlayed)
            .sort(byDisplayName);
    }

    /**
     * Stage every remaining fixture of one player in a single action.
     *
     * Each pair goes through `addOne`, which is the SAME push `addMatch`
     * performs - so a bulk-staged row is indistinguishable from a hand-staged
     * one, and every later control (result buttons, rollback, remove) works on it
     * without knowing how it arrived.
     *
     * Logged ONCE, with the count, rather than N times: this was one decision,
     * and N rows would drown the click log and make "add match" unreadable as a
     * measure of individual staging.
     */
    function addAllUnplayed(player) {
        const opponents = unplayedOpponents(player);
        if (!opponents.length) { addErr.textContent = 'Nothing left to add for this player'; return; }
        addErr.textContent = '';
        for (const opp of opponents) {
            const { wasPlayed, realWinner } = deriveBaselineState(player, opp);
            staged.push({
                a: player, b: opp, key: canonKey(player, opp),
                result: realWinner || 'NP',
                realWinner, wasPlayed,
            });
        }
        trackWhatIf(`What if: add all — ${opponents.length} matches vs ${player}`);
        inputA.value = '';
        inputB.value = '';
        picked.a = '';
        picked.b = '';
        comboA.setIdentity('');
        comboB.setIdentity('');
        renderStaged();
    }

    addBtn.addEventListener('click', addMatch);
    inputB.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMatch(); });

    function renderStaged() {
        if (staged.length === 0) {
            stagedHost.innerHTML = '<div class="whatif-empty">No matches staged yet. Add one above to start your scenario.</div>';
            return;
        }
        // A staged card is the echo of two picks, so each side is rendered with
        // the SAME identity chip the dropdown row used (flag · name · titles) —
        // via playerIdentityHtml, not a local copy of that markup. Long names
        // ellipsise inside the chip; the flag and badges never do.
        const stagedIdentity = (p) => playerIdentityHtml({
            name: displayPlayerName(p),
            flagCode: getFlagCode(p, whatifCustomFlags),
            titleHtml: titleHtmlFor(p),
        });
        stagedHost.innerHTML = staged.map((s, i) => {
            const playedBadge = s.wasPlayed
                ? `<span class="whatif-played-badge" title="This match was already played in the real league">PLAYED</span>`
                : `<span class="whatif-unplayed-badge" title="Not played yet in the real league">UNPLAYED</span>`;
            const rollback = (s.wasPlayed && s.result === 'NP')
                ? `<span class="whatif-warn" title="You are rolling back a real result to Not Played in this scenario">&#9888;</span>`
                : '';
            return `
                <div class="whatif-row ${s.wasPlayed ? 'was-played' : ''}" data-idx="${i}">
                    <span class="whatif-row-player">${stagedIdentity(s.a)}</span>
                    <span class="whatif-vs-small">vs</span>
                    <span class="whatif-row-player">${stagedIdentity(s.b)}</span>
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
                    const s = staged[idx];
                    const res = btn.dataset.res;
                    // Re-clicking the already-active result changes nothing, so
                    // it isn't logged — only a real change of the scenario is.
                    if (s.result !== res) {
                        trackWhatIf(res === 'NP'
                            ? `What if: not played — ${s.a} vs ${s.b}`
                            : `What if: winner — ${res === 'A' ? s.a : s.b} beats ${res === 'A' ? s.b : s.a}`);
                    }
                    s.result = res;
                    renderStaged();
                });
            });
            row.querySelector('.whatif-del').addEventListener('click', () => {
                const s = staged[idx];
                trackWhatIf(`What if: remove match — ${s.a} vs ${s.b}`);
                staged.splice(idx, 1);
                renderStaged();
            });
        });
    }
    renderStaged();

    clearBtn.addEventListener('click', () => {
        // Clearing an already-empty list is a no-op click, not a scenario reset.
        if (staged.length > 0) trackWhatIf(`What if: clear all — ${staged.length} staged`);
        staged.length = 0;
        renderStaged();
        // Back to the default state rather than an empty panel.
        runSimulation();
    });

    // Runs the projection over the current baseline + whatever is staged. With
    // nothing staged this is simply the default state (identical to the
    // Championship Predictor), which is what the table shows on first load —
    // the user sees a live table before touching anything.
    async function runSimulation() {
        addErr.textContent = '';
        const ribbon = document.getElementById('whatif-ribbon');
        if (ribbon) {
            ribbon.classList.toggle('is-baseline', staged.length === 0);
            ribbon.innerHTML = staged.length === 0
                ? 'CURRENT STATE &mdash; no changes applied yet'
                : 'SIMULATION &mdash; based on your what-if scenario';
        }
        if (output.hidden) {
            tableHost.innerHTML = '<div class="loading">Computing projection...</div>';
            output.hidden = false;
        }

        runBtn.disabled = true;
        runBtn.textContent = 'Simulating...';

        try {
            const matchLength = ctx.params.MatchLength || 7;

            // Start from the selected baseline (live state, or an earlier snapshot)
            const simMatches = [...baseline.played];
            const simRemaining = baseline.remaining.slice();

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

            // NOTHING STAGED = A POINT THAT ALREADY EXISTS.
            //
            // With no hypothetical results, "What If" is asking for the state at
            // the chosen baseline - which is a point on the timeline, already
            // projected and stored. Simulating it again would spend the CPU to
            // arrive at a slightly different random answer to a question that
            // has been answered, and the disagreement would be visible: stage a
            // result, remove it, and the numbers would not return to where they
            // started.
            //
            // A staged result makes a constellation that has never occurred, so
            // there is nothing to look up and it genuinely must be simulated.
            const stored = staged.length === 0
                ? await storedPointPrediction(ctx, baseline.value, simRemaining, simStatsMap)
                : null;

            const result = stored || predictChampionship({
                statsMap: simStatsMap,
                remainingMatches: simRemaining,
                matchLength,
                leagueConfig: ctx.leagueConfig,
                last300Map: await ensureLast300Map(ctx),
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
                // Not a display control: this changes the METRIC in the last
                // column (P(finish in top X)) and with it the whole table's
                // sort order — so the chosen X is what's worth logging.
                trackWhatIf(`What if topx: ${wiTopXInput.selectedOptions[0]?.textContent || currentX}`);
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
                    // Purely how many ROWS are shown — distinct from the Top X
                    // control above, which changes the numbers themselves.
                    trackWhatIf(`What if: table ${expanded ? 'expanded' : 'collapsed'} — ${total} players`);
                    renderTable(expanded);
                    expandBtn.textContent = expanded ? 'Show top 5' : `Show all (${total})`;
                };
            } else {
                expandBtn.style.display = 'none';
            }
        } catch (err) {
            console.error(err);
            tableHost.innerHTML = inlineErrorHtml("This scenario couldn't be simulated", err);
            output.hidden = false;
            console.error('What-if simulator error:', err);
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = 'Run Simulation';
        }
    }

    runBtn.addEventListener('click', () => {
        // Per-click summary of the staged scenario (which matches were
        // forced, not just "the button was clicked") — read via the existing
        // `[data-track]` path in js/analytics.js's click listener, which
        // fires on this same click event after this synchronous line runs.
        const stagedSummary = staged.map((s) =>
            s.result === 'NP' ? `${s.a} vs ${s.b} not played` : `${s.result === 'A' ? s.a : s.b} beats ${s.result === 'A' ? s.b : s.a}`
        ).join('; ');
        runBtn.dataset.track = `What if: run — ${staged.length} staged${stagedSummary ? ' — ' + stagedSummary : ''}`.slice(0, 300);
        runSimulation();
    });

    // Show the default (unmodified) projection without waiting for input, so
    // the section is never an empty shell — but not until the section is on
    // screen. This is a second full Monte Carlo run (see renderPredictor's
    // note): together the two accounted for ~76% of a warm navigation into
    // this page, both of them for panels behind a tab. Deferring costs nothing
    // when the tab IS opened and removes the cost entirely when it is not.
    whenVisible(document.getElementById('whatif-section') || runBtn).then(runSimulation);
}

function canonKey(a, b) {
    return [a, b].sort().join('|');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * The snapshot picker, shared by the Historical view (B2) and What-If's "Run
 * from" (B4) — the ONE control both use, so a point can never be offered by one
 * and missing from the other.
 *
 * A point is a MATCH, so the row is rendered as one: the date, then the winner
 * and the loser as full identity chips (flag · name · title badges) via
 * `playerIdentityHtml`, the same chip the What-If pickers and staged cards use.
 * That is why this is the canonical search field rather than a `<select>` — a
 * native option can hold text and nothing else, so a picker that shows who beat
 * whom cannot be one. The field also filters, which is what makes a hundred-row
 * list usable: type a name and see only that player's matches.
 *
 * The ‹ › buttons keep their old meaning (‹ = newer, the list is newest-first).
 *
 * @returns {{ value: () => string, index: () => number, option: () => object }}
 */
function mountSnapshotPicker({ input, prevBtn, nextBtn, options, params, onChange }) {
    const indexOf = new Map(options.map((o, i) => [o.value, i]));
    let index = 0;
    // Rows carry title badges; priming is memoised, so calling it from both
    // pickers costs one load. decorate() runs when the list OPENS, by which time
    // the fetch that starts here has long landed — but the FIELD paints before
    // then, and a badge arriving later changes the row's width, so the fit is
    // measured again once the metadata is in.
    primeTitleMeta().then(() => paintDisplay());

    const identity = (name) => playerIdentityHtml({
        name: displayPlayerName(name),
        flagCode: getFlagCode(name, params.CustomFlags),
        titleHtml: titleHtmlFor(name),
    });

    // "Current" and "Initial" carry no match — they stay plain text.
    const nameHtmlFor = (o) => {
        if (!o || !o.match) return '';
        const { winner, loser, drawn } = resultSides(o.match);
        // The live state is marked by WEIGHT, not by a pill. A "CURRENT" badge
        // measured 51px, and on a 313px phone field that was the difference
        // between the whole row fitting and the date plus a player's name being
        // truncated on 17 of this league's 89 matches. Bold costs nothing.
        return `<span class="snap-opt${o.current ? ' is-current' : ''}">`
            + `<span class="snap-opt-date">${escapeHtml(o.dateLabel)}</span>`
            + `<span class="snap-opt-side">${identity(winner)}</span>`
            + `<span class="snap-opt-verb">${drawn ? 'draws' : 'beats'}</span>`
            + `<span class="snap-opt-side">${identity(loser)}</span>`
            + `</span>`;
    };

    const combo = mountSearchField(input, {
        getOptions: () => options.map(o => ({ value: o.value, label: o.label })),
        labelFor: (v) => (options[indexOf.get(v)] || {}).label || v,
        decorate: (v) => ({ nameHtml: nameHtmlFor(options[indexOf.get(v)]) }),
        allowFreeText: false,
        browseOnOpen: true,
        onPick: (v) => { if (indexOf.has(v)) select(indexOf.get(v)); },
    });

    // The FIELD shows what the row showed — flags and title badges included.
    //
    // An <input> holds text and nothing else, and the combobox's own identity
    // chrome has one flag slot and one badge slot: it describes ONE player, and
    // this field's subject is a match. So the picked row is echoed by an overlay
    // laid over the field, carrying the identical chip markup. It is
    // pointer-events:none, so a click still lands on the input underneath and
    // focuses it; focus hides the overlay and hands the field back to typing,
    // which is what makes the same control both a display and a search box.
    //
    // Its font-size is copied from the input for the reason the identity chrome
    // documents: the chips size in em, and left alone they would resolve against
    // the wrapper's inherited size instead of the field's.
    const display = document.createElement('span');
    display.className = 'snap-display';
    display.setAttribute('aria-hidden', 'true');
    input.parentElement.appendChild(display);

    // Does THIS row fit on one line? Asked per selection, not answered once by a
    // width threshold — the rows differ enormously ("ys beats Yaniv162" against
    // "Hummus NC M2 beats YossiEliezer23"), so a single breakpoint is always
    // wrong for half of them: it stacks short rows that had room to spare and
    // truncates long ones that never did. The probe renders the same markup with
    // the one-line rules and no width limit, and its natural width is compared
    // with what the field actually has.
    const probe = document.createElement('span');
    probe.className = 'snap-display snap-display--probe';
    probe.setAttribute('aria-hidden', 'true');
    input.parentElement.appendChild(probe);

    function paintDisplay() {
        const o = options[index];
        const html = nameHtmlFor(o) || escapeHtml(o.label);
        const fontSize = getComputedStyle(input).fontSize;
        display.innerHTML = html;
        display.style.fontSize = fontSize;
        probe.style.fontSize = fontSize;
        probe.innerHTML = html;
        // clientWidth excludes the border but includes padding, which the probe
        // also carries — so the two are measured on the same terms.
        display.classList.toggle('is-stacked', probe.scrollWidth > display.clientWidth);
        display.hidden = document.activeElement === input;
    }

    input.addEventListener('focus', () => { display.hidden = true; });
    input.addEventListener('blur', () => { setTimeout(paintDisplay, 160); });

    // The fit depends on the field's width, so it has to be re-asked whenever
    // that width can have changed — not only when the selection does. Measured
    // once at paint time, a window resize left a 309px row inside a 244px field,
    // truncated instead of stacked, because nothing had asked the question again.
    // Both signals are needed, and the combobox's identity chrome documents why:
    // the observer catches an actual width change, while a `resize` with no width
    // change can still move the clamp()-driven font under it.
    let queued = false;
    const remeasure = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; paintDisplay(); });
    };
    if (typeof ResizeObserver === 'function') new ResizeObserver(remeasure).observe(input.parentElement);
    window.addEventListener('resize', remeasure);

    function paint() {
        // setValue, never `input.value =` — it writes the label AND records the
        // field's subject, which is what `browseOnOpen` restores on blur. Writing
        // the text directly left the subject empty, so opening the list and
        // leaving without picking blanked the field.
        combo.setValue(options[index].value);
        paintDisplay();
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = index >= options.length - 1;
    }

    function select(i, opts = {}) {
        index = i;
        paint();
        combo.close();
        if (!opts.silent) onChange(options[index]);
    }

    prevBtn.addEventListener('click', () => { if (index > 0) select(index - 1); });
    nextBtn.addEventListener('click', () => { if (index < options.length - 1) select(index + 1); });
    select(0, { silent: true });

    return { value: () => options[index].value, index: () => index, option: () => options[index] };
}

/** matchKey -> the date the pairing's result last changed (B5/B6's Date column). */
function buildPlayedAtMap(timeline) {
    const playedAt = new Map();
    for (const h of timeline) {
        if (h.updatedAt) playedAt.set(matchKey(h.playerA, h.playerB), h.updatedAt);
    }
    return playedAt;
}

// ---------- F3 ----------
function renderRounds(ctx) {
    const { allMatchesIncUnplayed, roundCount, timeline, leagueId, playersMeta, params, leagueConfig } = ctx;
    let current = 1;
    let showAll = false;

    // matchKey -> updatedAt, off the same timeline the update points come from
    const playedAt = buildPlayedAtMap(timeline);

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
        drawMatchTable(document.getElementById('round-table'), list, {
            playedAt, leagueId, playersMeta, customFlags: params.CustomFlags, leagueConfig,
            tableId: 'B6',
        });
        prev.disabled = showAll || current <= 1;
        next.disabled = showAll || current >= roundCount;
    }

    prev.addEventListener('click', () => { if (current > 1) { current--; paint(); } });
    next.addEventListener('click', () => { if (current < roundCount) { current++; paint(); } });
    all.addEventListener('click', () => { showAll = !showAll; paint(); });

    paint();
}

// ---------- Played Matches (B5) ----------
// Every played match in the league, most-recent-first, capped at 10 with a Show-all toggle.
// Same MF columns + sticky settings as Rounds (B6); winner name green / loser red.
function renderPlayedMatches(ctx) {
    const { liveMatches, allMatchesIncUnplayed, timeline, leagueId, playersMeta, params, leagueConfig } = ctx;
    const host = document.getElementById('played-matches-table');
    if (!host) return;

    // matchKey -> updatedAt, so we can both stamp the Date column and sort
    // chronologically. Off the timeline, so every date shown here is an update
    // point the Historical / What-If pickers also offer, and vice versa.
    const playedAt = buildPlayedAtMap(timeline);

    // A match the authoritative set (overrides applied) marks NOT played must never
    // show here — even if a stale history row still carries a date for it. Guard
    // explicitly rather than trusting liveMatches to already be played-only.
    const unplayedKeys = new Set(
        allMatchesIncUnplayed.filter(m => !m.played).map(m => matchKey(m.playerA, m.playerB))
    );

    // Every remaining liveMatches entry is a played match, but neither the build
    // path nor the history merge keeps a `played` flag, so stamp one on so
    // drawMatchTable renders scores/date/tint rather than treating each row as unplayed.
    const played = liveMatches
        .filter(m => !unplayedKeys.has(matchKey(m.playerA, m.playerB)))
        .map(m => ({ ...m, played: true }));

    // Most-recent-first; matches without a recorded date sort to the bottom.
    const sorted = played.slice().sort((a, b) => {
        const ta = playedAt.get(matchKey(a.playerA, a.playerB));
        const tb = playedAt.get(matchKey(b.playerA, b.playerB));
        if (ta && tb) return new Date(tb) - new Date(ta);
        if (ta) return -1;
        if (tb) return 1;
        return 0;
    });

    const TOP_N = 10;
    let showAll = false;

    // Show-all button (only meaningful when there are more than TOP_N played matches).
    let btn = null;
    if (sorted.length > TOP_N) {
        btn = document.createElement('button');
        btn.className = 'show-more-btn';
        btn.textContent = `Show all (${sorted.length})`;
        btn.addEventListener('click', () => {
            showAll = !showAll;
            paint();
            btn.textContent = showAll ? `Show top ${TOP_N}` : `Show all (${sorted.length})`;
        });
    }

    function paint() {
        const list = showAll ? sorted : sorted.slice(0, TOP_N);
        drawMatchTable(host, list, {
            playedAt, leagueId, playersMeta, customFlags: params.CustomFlags, leagueConfig,
            tableId: 'B5',
        });
        if (btn) host.appendChild(btn);
    }

    paint();
}

function drawMatchTable(host, matches, opts = {}) {
    const { playedAt, leagueId, playersMeta = {}, customFlags = {}, leagueConfig = null, tableId = 'B6' } = opts;
    const showPR = leagueConfig ? leagueConfig.showPR : true;
    const colCount = showPR ? 8 : 6;
    let html = `<div class="rounds-scroll-wrap"><table class="dash-table font-small" data-mf-table-id="${tableId}"><thead><tr>`
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
        // Date AND time, per the site-wide rule (matchTime.js). The year is no
        // longer abbreviated: a two-digit year next to a clock reads as another
        // time field ("5 Jul 26, 16:49"), and the column is already wide enough
        // for the full one now that it carries a clock at all.
        const playedCell = updated
            ? formatMatchStamp(updated)
            : (isPlayed ? '—' : '<span style="color:var(--color-text-muted)">unplayed</span>');
        const rowClass = isPlayed ? '' : 'unplayed-row';
        // Winner name green / loser red — played rows only (no class on ties or unplayed).
        const resA = isPlayed && m.scoreA > m.scoreB ? ' result-win' : (isPlayed && m.scoreA < m.scoreB ? ' result-loss' : '');
        const resB = isPlayed && m.scoreB > m.scoreA ? ' result-win' : (isPlayed && m.scoreB < m.scoreA ? ' result-loss' : '');
        const flagA = getFlagCode(m.playerA, customFlags);
        const flagB = getFlagCode(m.playerB, customFlags);
        const hiddenA = !!(playersMeta[m.playerA] && playersMeta[m.playerA].hidden);
        const hiddenB = !!(playersMeta[m.playerB] && playersMeta[m.playerB].hidden);
        html += `<tr class="${rowClass}">`
            + `<td class="player-cell${resA}">${hiddenA ? '' : `<img class="flag" src="${flagUrl(flagA)}" alt="${flagA}">`} ${playerNameLink(m.playerA, playersMeta[m.playerA])}</td>`
            + `<td class="player-cell${resB}">${hiddenB ? '' : `<img class="flag" src="${flagUrl(flagB)}" alt="${flagB}">`} ${playerNameLink(m.playerB, playersMeta[m.playerB])}</td>`
            + `<td>${isPlayed ? m.scoreA + ' - ' + m.scoreB : '—'}</td>`
            + (showPR ? `<td>${isPlayed && m.prA != null ? formatNumber(m.prA) : '—'}</td><td>${isPlayed && m.prB != null ? formatNumber(m.prB) : '—'}</td>` : '')
            + `<td>${isPlayed && m.luckA != null ? formatNumber(m.luckA) : '—'}</td>`
            + `<td>${isPlayed && m.luckB != null ? formatNumber(m.luckB) : '—'}</td>`
            + `<td>${playedCell}</td></tr>`;
    }
    if (matches.length === 0) html += `<tr><td colspan="${colCount}">No matches</td></tr>`;
    html += '</tbody></table></div>';
    host.innerHTML = html;
    attachPlayerNameInteractions(host, leagueId);
    const wrap = host.querySelector('.rounds-scroll-wrap');
    if (wrap) {
        // 3 sticky cols (Player A / Player B / …) → 2 measured offsets. Both
        // player cells carry a flag, so this table is trap 2 in stickyCols.js.
        pinStickyCols(wrap.querySelector('table'), ['--col1-w', '--col2-w'], { target: wrap });
        attachStickyShadow(wrap);
    }
}

// ---------- Remaining Matches (B7a / B7b / B7c) ----------
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

// Export control shared by B7a/B7b/B7c: a right-aligned row holding either
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
            exportRemainingMatchesImage(sourceTable, ctx.leagueId, formatAsOf(lastModified), params.LeagueType || 'doubling');
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
    const { statsMap, rankings } = rankLeague({ matches: liveMatches, allPlayers: allPlayersSet, config: leagueConfig });
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
        exportB6bImage(sourceTable, ctx.leagueId, formatAsOf(lastModified), params.LeagueType || 'doubling');
    }));

    const wrap = document.createElement('div');
    wrap.className = 'rem-b6b-wrap';
    wrap.innerHTML = buildB6bTableHtml(playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames);
    panel.appendChild(wrap);
}

function buildB6bTableHtml(playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames) {
    let html = '<table class="dash-table font-small player-remaining-table" data-mf-table-id="B7b"><thead><tr>'
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
    // Ordered by the name the rows DISPLAY — see renderPlayerSection for why a
    // plain .sort() reads as unsorted once "Show name as" is set to full names.
    const allPlayers = [...ctx.allPlayersSet].filter(p => p && p !== 'Bye')
        .sort((a, b) => displayPlayerName(a, playersMeta[a]).localeCompare(displayPlayerName(b, playersMeta[b])));

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
    const title = ctx.leagueId; // full league name (id), never the short LeagueTitle

    // The field shows the DISPLAY name, so its text is no longer the key this
    // panel looks players up by. Accept either form, so a name typed by hand
    // works whichever one the user is looking at.
    const resolvePlayer = (text) => {
        const q = text.trim().toLowerCase();
        if (!q) return '';
        return allPlayers.find(p => p.toLowerCase() === q
            || displayPlayerName(p, playersMeta[p]).toLowerCase() === q
            || (alternateName(p, playersMeta[p]) || '').toLowerCase() === q) || '';
    };

    function showPlayer(rawVal) {
        const player = resolvePlayer(rawVal);
        if (!player) { result.innerHTML = ''; return; }

        const opponents = (unplayedByPlayer.get(player) || []).slice()
            .sort((a, b) => displayPlayerName(a, playersMeta[a]).localeCompare(displayPlayerName(b, playersMeta[b])));
        result.innerHTML = `
            <div class="rem-b6c-header">
                <span class="rem-b6c-player-name">${playerIdentityHtml({
                    name: displayPlayerName(player, playersMeta[player]),
                    flagCode: getFlagCode(player, params.CustomFlags),
                    titleHtml: getTitleAbbreviationsHtml(playersMeta[player]),
                })}</span>
                &mdash; <span class="rem-b6c-rem-count">${opponents.length} remaining match${opponents.length !== 1 ? 'es' : ''}</span>
            </div>
            <div class="rem-b6c-export-row"></div>
            <div class="rem-b6c-wrap">${buildB6cTableHtml(opponents, params.CustomFlags, playersMeta)}</div>`;

        result.querySelector('.rem-b6c-export-row').appendChild(
            buildExportControl(opponents.length, () => {
                const sourceTable = result.querySelector('.rem-b6c-wrap table');
                // The exported image's subtitle names the player too — display
                // name, matching the heading and the rows it ships with.
                exportB6cImage(sourceTable, title, displayPlayerName(player, playersMeta[player]),
                    formatAsOf(lastModified), params.LeagueType || 'doubling');
            })
        );
    }

    input.addEventListener('input', () => showPlayer(input.value));
    input.addEventListener('change', () => showPlayer(input.value));
    // The list carries the same flag + title badges every other player search
    // shows, and the picked name keeps them beside the field (`identity`) —
    // this lookup used to be the one player search rendering bare text, even
    // though the table it opens has shown flags and titles all along.
    mountCombobox(input, {
        getOptions: () => allPlayers,
        // Honours "Show name as", like every other player picker. The panel no
        // longer reads the field's text as a key (see resolvePlayer), so the
        // field is free to show the full name.
        labelFor: (p) => displayPlayerName(p, playersMeta[p]),
        altFor: (p) => alternateName(p, playersMeta[p]),
        decorate: (p) => ({
            flagCode: getFlagCode(p, params.CustomFlags),
            titleHtml: getTitleAbbreviationsHtml(playersMeta[p]),
        }),
        identity: true,
        browseOnOpen: true,
        // The panel below is driven by this one callback rather than by the
        // legacy re-dispatched `input` event, so a pick writes the LABEL to the
        // field while `showPlayer` still receives it and resolves the key.
        onPick: (p) => {
            input.value = displayPlayerName(p, playersMeta[p]);
            showPlayer(input.value);
        },
    });
}

function buildB6cTableHtml(opponents, customFlags, playersMeta) {
    if (opponents.length === 0) {
        return `<div style="color:var(--color-text-muted);padding:var(--space-sm);text-align:center">All matches played!</div>`;
    }
    let html = '<table class="dash-table font-small rem-b6c-table" data-mf-table-id="B7c"><thead><tr>'
        + '<th scope="col" class="player-col">Unplayed Opponent</th>'
        + '</tr></thead><tbody>';
    for (const opp of opponents) {
        const flagCode = getFlagCode(opp, customFlags);
        const titlesHtml = getTitleAbbreviationsHtml(playersMeta[opp]);
        // The display name, like the heading above this table and like the
        // picker that opened it. This table is also what "Export Image" ships
        // to WhatsApp, so a username here would send the one name the user
        // asked NOT to see.
        const shown = displayPlayerName(opp, playersMeta[opp]);
        html += `<tr><td class="player-cell"><img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${escapeHtml(shown)}${titlesHtml}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function buildRemainingListHtml(matches, customFlags, playersMeta) {
    let html = `<table class="dash-table font-small" data-mf-table-id="B7a"><thead><tr>`
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

// "Last updated <date>" subtitle suffix shared by B7a/B7b/B7c exports —
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
// All three are narrow tables (B7a/B7b: 2 cols, B7c: 1 col), so they pass
// shrinkToContent \u2014 stretching them across the frame would leave each cell
// mostly empty. Columns size to their text and the table is centred instead.
//
// B7c's filename carries the SAME player text as the subtitle and the rows:
// the display name under the current "Show name as" setting. The downloaded
// PNG then matches what it shows, which is the point of naming it at all.
// exportFilename() in exportTableImage.js makes that safe \u2014 a full name with
// spaces becomes one underscored token and reserved characters are stripped.

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
    // Sorted by the name the picker DISPLAYS, not by the username key: with
    // "Show name as" set to full names a plain .sort() ordered the list by a
    // string the user cannot see (Hummus sat under H while the row read "I S"),
    // so the list looked unsorted. localeCompare also orders Hebrew correctly.
    const players = [...allPlayersSet]
        .sort((a, b) => displayPlayerName(a).localeCompare(displayPlayerName(b)));
    const totalMatchesPerPlayer = players.length - 1;
    // REGULAR leagues record no PR — offer only the Luck metric.
    const showPR = ctx.leagueConfig.showPR;

    const container = document.getElementById('charts-container');
    // Title badges for the pickers below — one canonical source, cached, and
    // idempotent, so it does not matter which section primes it first.
    primeTitleMeta();

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
            for (const m of buildPlayerSeries(liveMatches, p.player)) {
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
                <input type="text" class="player-pick app-search-input" placeholder="Search player…" autocomplete="off">
                <label>Metric:</label>
                <select class="metric-pick">
                    ${showPR ? '<option value="pr">PR</option>' : ''}
                    <option value="luck"${showPR ? '' : ' selected'}>Luck</option>
                </select>
                <a class="open-full-btn player-card-link" href="#" title="Open full player card">Open player card &rsaquo;</a>
                <button class="remove-chart" title="Remove this chart" data-track="Compare: remove player chart">&times;</button>
            </div>
            <div class="chart-host"></div>
        `;
        container.appendChild(panel);

        const playerPick = panel.querySelector('.player-pick');
        const metricSel = panel.querySelector('.metric-pick');
        const link = panel.querySelector('.player-card-link');
        const host = panel.querySelector('.chart-host');
        const removeBtn = panel.querySelector('.remove-chart');

        function redraw() {
            const player = entry.player;
            const metric = metricSel.value;
            link.href = playerLeagueUrl(leagueId, player);
            const matches = buildPlayerSeries(liveMatches, player);
            drawPlayerBarChart(host, matches, metric, totalMatchesPerPlayer, sharedScale[metric]);
        }

        // `player` is the entry's own state, not the field's text: the field
        // shows the DISPLAY name (which may be a full name) while every lookup
        // here needs the username key.
        const entry = { panel, player: initialPlayer, metricSel, redraw };
        panels.push(entry);

        // The picker is the project's canonical search field, not a bare
        // <select>. The section right below this one had already moved; leaving
        // this one native meant the two charts stacked on the same screen
        // offered visibly different controls — and an <option> can hold neither
        // the flag nor the title badges every other player reference carries.
        playerPick.value = displayPlayerName(initialPlayer);
        const combo = mountSearchField(playerPick, {
            getOptions: () => players,
            labelFor: displayPlayerName,
            altFor: (p) => alternateName(p, ctx.playersMeta[p]),
            decorate: (p) => ({
                flagCode: getFlagCode(p, ctx.params?.CustomFlags || {}),
                titleHtml: titleHtmlFor(p),
            }),
            identity: true,
            browseOnOpen: true,
            onPick: (name) => {
                entry.player = name;
                playerPick.value = displayPlayerName(name);
                // Analytics: a picker choice is not a DOM click, so announce it,
                // naming the chosen player (public league data, as "Player link:").
                window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target: `Compare: change player: ${name}` } }));
                redrawAll();
            },
        });
        combo.setIdentity(initialPlayer);

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
 * before binning — the same shifted value also feeds the Table Validation
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
    const games = values.length;
    const meanDir = mean >= 0 ? 'better' : 'worse';
    const meanDirHe = mean >= 0 ? 'טוב יותר' : 'גרוע יותר';
    // toFixed() yields an ASCII hyphen-minus (U+002D) — thin next to bold digits.
    // Use a real MINUS SIGN (U+2212) so a negative's sign matches the number.
    const mfix = s => String(s).replace('-', '−');
    const loBand = mfix((mean - std).toFixed(2));
    const hiBand = mfix((mean + std).toFixed(2));
    const abs = Math.abs(mean).toFixed(2);

    return `
        <button class="predictor-info-close corr-gaussian-popup-close" aria-label="Close">&times;</button>
        <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
        <div class="popup-lang-en" data-lang="en">
        <h4>What do &mu; and &sigma; actually mean?</h4>
        <p><b>&mu; (mean) = ${mfix(mean.toFixed(2))}</b>: on average, across the ${games} matches, the winner's PR was about ${abs} points ${meanDir} than the loser's.</p>
        <p><b>&sigma; (standard deviation) = ${std.toFixed(2)}</b>: in about 66.7% of those ${games} matches the winner-side PR gap was between <b>${loBand}</b> and <b>${hiBand}</b>.</p>
        </div>
        <div class="popup-lang-he" data-lang="he">
        <h4>מה בעצם &mu; ו-&sigma; אומרים?</h4>
        <p><b>&mu; (ממוצע) = <span dir="ltr">${mfix(mean.toFixed(2))}</span></b>: בממוצע, על פני ${games} הדו קרבות, למנצח היה PR ${meanDirHe} בכ-${abs} נקודות מהמפסיד.</p>
        <p><b>&sigma; (סטיית תקן) = ${std.toFixed(2)}</b>: בכ-66.7% מ-${games} הדו קרבות פער ה-PR מצד המנצח היה בין <b><span dir="ltr">${loBand}</span></b> ל-<b><span dir="ltr">${hiBand}</span></b>.</p>
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
        const dash = { html: '&mdash;' };
        const rowsCfg = gapRows.map(r => {
            if (r.dataPct == null) {
                return { cells: [
                    { html: String(r.gap) }, { html: '0' }, dash, dash, dash,
                    { html: `${r.tablePct.toFixed(1)}%` }, dash, dash, dash,
                ] };
            }
            const dataColor = colorForValue(r.dataPct, pctMin, pctMax);
            const tableColor = colorForValue(r.tablePct, pctMin, pctMax);
            // Error/Likelihood/"What this means" all use the separate
            // confidence (blue-amber-red) theme, keyed off this row's own
            // likelihood, so the three cells read as one consistent verdict on
            // the row rather than three independently-scaled numbers.
            const confColor = colorForConfidence(Math.min(r.likelihood, 0.5), 0, 0.5);
            return { cells: [
                { html: String(r.gap) },
                { html: String(r.total) },
                { html: String(r.posCount) },
                { html: String(r.negCount) },
                { html: `${r.dataPct.toFixed(1)}%`, color: dataColor },
                { html: `${r.tablePct.toFixed(1)}%`, color: tableColor },
                { html: `${r.error >= 0 ? '+' : ''}${r.error.toFixed(1)}`, color: confColor },
                { html: `${(r.likelihood * 100).toFixed(1)}%`, color: confColor },
                { html: likelihoodAssessment(r.likelihood, lang), color: confColor },
            ] };
        });

        const headers = lang === 'he'
            ? ['הפרש PR', 'דו קרבות', 'ניצחונות המועדף', 'הפסדי המועדף', 'Win% של הנתונים', 'Win% של הטבלה', 'שגיאה', 'Likelihood', 'המשמעות']
            : ['PR gap', 'Matches', 'Favourite wins', 'Favourite loses', 'Win% of data', 'Win% of table', 'Error', 'Likelihood', 'What this means'];
        const caption = lang === 'he' ? 'אימות טבלה — פער אחר פער' : 'Table Validation — gap by gap';
        const note = lang === 'he' ? 'רק דו קרבות עם קוביית הכפלה (Doubling).' : 'Doubling-cube matches only.';

        return pmTableHtml({
            variant: 'list',
            caption,
            note,
            scroll: true,
            cols: headers.map(h => ({ label: h })),
            rows: rowsCfg,
        });
    }

    return `
        <button class="predictor-info-close corr-explanation-popup-close" aria-label="Close">&times;</button>
        <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
        <div class="popup-lang-en" data-lang="en">
        <h4>Table Validation: does the data match the table?</h4>
        <p><b>Why it's here:</b> the <i>PR Win-Probability Table</i> is a fixed, published table giving, for every
        PR gap and match length, the favourite's win chance &mdash; and this whole page leans on it. But is that
        table actually right for our players? This check pools every ${leagueTypePill('doubling')} match ever played (at
        this match length) and asks, for every PR gap, whether the favourite won as often as the table predicts.</p>
        ${tableValidationExampleHistogramSvg('en')}
        <p>For each PR gap, the comparison of the favourite's real win rate against the table's value is called
        <b>Likelihood</b>, and its meaning is &mdash; how likely it was that this gap's result came up by chance alone.</p>
        ${renderTable('en')}
        </div>
        <div class="popup-lang-he" data-lang="he">
        <h4>אימות טבלה: האם הנתונים תואמים את הטבלה?</h4>
        <p><b>למה זה כאן:</b> ה-<i>PR Win-Probability Table</i> היא טבלה קבועה ומפורסמת שנותנת, לכל פער PR ואורך
        דו קרב, את הסיכוי שהמועדף ינצח &mdash; וכל העמוד הזה נשען עליה. אבל האם הטבלה הזו באמת נכונה עבור השחקנים
        שלנו? הבדיקה הזו מרכזת את כל דו קרבות ${leagueTypePill('doubling')} ששוחקו אי פעם (באותו אורך דו קרב) ושואלת, עבור כל פער PR,
        האם המועדף ניצח בתדירות שהטבלה חוזה.</p>
        ${tableValidationExampleHistogramSvg('he')}
        <p>לכל פער PR השוואת שיעור הניצחון האמיתי של המועדף מול הערך שבטבלה נקראת <b>Likelihood</b>, ומשמעותה &mdash;
        עד כמה סביר היה שתוצאת אותו פער תצא במקרה בלבד.</p>
        ${renderTable('he')}
        </div>
    `;
}

function corrMatchInfoHtml(m) {
    const dateStr = formatMatchStamp(m.updatedAt);
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
    // REGULAR leagues record no PR — the two correlation sections aren't in the
    // DOM for them (see insightsPanel), so there's nothing to render.
    if (!ctx.leagueConfig.showPR) return;
    const { liveMatches } = ctx;
    // By display name, for the same reason as the section above: the list must
    // be ordered by the string the row actually shows.
    const players = [...ctx.allPlayersSet]
        .sort((a, b) => displayPlayerName(a).localeCompare(displayPlayerName(b)));
    // Luck percentile beside each candidate in the row pickers below, scoped to
    // THIS league — the same matches these charts draw, so a number read in the
    // picker is the number that candidate's own Luck bar will show once their
    // chart is stacked. Title badges come from the shared cached source.
    primeTitleMeta();
    const corrLuck = createLeagueLuckSource({ matches: liveMatches, params: ctx.params, config: ctx.leagueConfig });
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
    const { rankings: generalRankings } = rankLeague({
        matches: liveMatches, allPlayers: ctx.allPlayersSet, config: ctx.leagueConfig
    });
    const generalMatchStats = computeMatchStats(generalRankings, ctx.allPlayersSet.size);
    generalPanel.innerHTML = `
        <div class="dash-controls corr-controls">
            <div class="corr-controls-top">
                <label>League &mdash; all matches (${generalMatchStats.playedMatches}/${generalMatchStats.totalMatches})</label>
                <span class="corr-gaussian-stats"></span>
                <div class="corr-shift-group">
                    <button class="corr-gaussian-toggle" type="button" disabled data-track="Chart tool: Gaussian fit" title="Overlays a fitted normal (Gaussian) curve on this histogram, using this data's own mean and standard deviation &mdash; a visual reference only, not a claim that the data is actually normally distributed.">Gaussian fit</button>
                    <button class="corr-trim-toggle" type="button" disabled data-track="Chart tool: Trim to 99%" title="Zooms the X-axis in to the middle 99% of this league's matches (symmetric around 0), hiding the outlier bins beyond that. Display only &mdash; the Gaussian fit below always uses the full, untrimmed data.">Trim to 99%</button>
                    <div class="corr-shift-control" title="Adds this many PR points to every match's PR gap before recomputing the Gaussian fit below &mdash; use it to test whether the distribution's centre is off by a constant amount. 0 = the model's real, unshifted PR gaps.">
                        <button class="corr-shift-btn" data-dir="-1" aria-label="Decrease PR-gap shift" disabled data-track="Chart tool: PR-gap shift down">&minus;</button>
                        <span class="corr-shift-value">
                            <span class="corr-shift-caption">PR-gap shift</span>
                            <b class="corr-shift-amount">0</b>
                        </span>
                        <button class="corr-shift-btn" data-dir="1" aria-label="Increase PR-gap shift" disabled data-track="Chart tool: PR-gap shift up">+</button>
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
                    <button class="corr-gaussian-toggle" type="button" disabled data-track="Chart tool: Gaussian fit" title="Overlays a fitted normal (Gaussian) curve on this histogram, using this data's own mean and standard deviation &mdash; a visual reference only, not a claim that the data is actually normally distributed.">Gaussian fit</button>
                    <button class="corr-explanation-toggle" type="button" disabled data-track="Chart tool: Table Validation" title="Compares this row's real data against the win-probability table, gap by gap, with a likelihood check on how surprising each row's result is.">Table Validation</button>
                    <button class="corr-trim-toggle" type="button" disabled data-track="Chart tool: Trim to 99%" title="Zooms the X-axis in to the middle 99% of all-time matches (symmetric around 0), hiding the outlier bins beyond that. Display only &mdash; the Gaussian fit and Table Validation below always use the full, untrimmed data.">Trim to 99%</button>
                    <div class="corr-shift-control" title="Adds this many PR points to every match's PR gap before recomputing the Gaussian fit and Table Validation table below &mdash; use it to test whether the model's calibration point is off by a constant amount. 0 = the model's real, unshifted PR gaps.">
                        <button class="corr-shift-btn" data-dir="-1" aria-label="Decrease PR-gap shift" disabled data-track="Chart tool: PR-gap shift down">&minus;</button>
                        <span class="corr-shift-value">
                            <span class="corr-shift-caption">PR-gap shift</span>
                            <b class="corr-shift-amount">0</b>
                        </span>
                        <button class="corr-shift-btn" data-dir="1" aria-label="Increase PR-gap shift" disabled data-track="Chart tool: PR-gap shift up">+</button>
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
                    <input type="text" class="player-pick app-search-input" placeholder="Search player…" autocomplete="off">
                    <span class="corr-games-count"></span>
                    <button class="remove-chart" title="Remove this chart" data-track="Compare: remove player chart">&times;</button>
                </div>
                <span class="corr-metric-pill corr-luck-pill"></span>
            </div>
            <div class="chart-host corr-host"></div>
        `;
        container.appendChild(panel);

        const gamesCount = panel.querySelector('.corr-games-count');
        const luckPill = panel.querySelector('.corr-luck-pill');
        const host = panel.querySelector('.corr-host');
        const removeBtn = panel.querySelector('.remove-chart');

        // This picker runs on the project's ONE canonical search field rather
        // than a bare <select>, so it can carry the thing this section is
        // about: each candidate's LUCK PERCENTILE, beside their name, in the
        // shared value colour. A native <option> strips markup and tints its
        // whole row, so the figure could neither sit apart from the name nor
        // keep its own colour there.
        const playerPick = panel.querySelector('.player-pick');
        let currentPlayer = initialPlayer;
        playerPick.value = displayPlayerName(currentPlayer);
        const combo = mountSearchField(playerPick, {
            getOptions: () => players,
            labelFor: displayPlayerName,
            altFor: (p) => alternateName(p, ctx.playersMeta[p]),
            decorate: (p) => ({
                flagCode: getFlagCode(p, ctx.params?.CustomFlags || {}),
                titleHtml: titleHtmlFor(p),
                luckHtml: corrLuck.htmlFor(p),
            }),
            identity: true,
            browseOnOpen: true,
            onPick: (name) => {
                currentPlayer = name;
                playerPick.value = displayPlayerName(name);
                // Analytics: a picker choice is not a DOM click, so announce it,
                // naming the chosen player (public league data, as "Player link:").
                window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target: `Compare: change player: ${name}` } }));
                redraw();
            },
        });
        // The panel opens with a player already in the field, so paint that
        // player's identity too — a preselected row is still a selection.
        combo.setIdentity(currentPlayer);

        function redraw() {
            const player = currentPlayer;
            const series = buildPlayerAdvantageSeries(liveMatches, player);
            gamesCount.textContent = `(${series.length}/${players.length - 1} matches)`;
            const mlIdx = nearestMatchLengthIdx(ctx.params.MatchLength || 7);
            const items = series.map(m => ({
                pWin: getWinProbability(m.prSelf, m.prOpp, mlIdx),
                outcome: m.win ? 1 : 0
            }));
            applyLuckPill(luckPill, luckConfidenceFromItems(items));
            drawCorrelationRow(host, series.map(m => ({ x: m.advantage, win: m.win, match: m })), {
                xMin: playerDomain.xMin,
                xMax: playerDomain.xMax,
                showAxis: true,
                buildInfoHtml: (p) => corrMatchInfoHtml(p.match)
            });
        }

        const entry = { panel, redraw };
        panels.push(entry);

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
        const sameTypeLeagues = leagues.filter(l => l.leagueType === leagueType);
        // Distinct match-length columns present among same-type leagues. Each is
        // a genuinely different win-probability model, so the aggregate is read
        // one length at a time — never pooled across lengths, since it is compared
        // against a single table column. The selector below appears only when
        // there is more than one to choose between.
        const lenIdxSet = new Set(sameTypeLeagues.map(l => nearestMatchLengthIdx(l.params.MatchLength || 7)));
        let poolMlIdx = generalMlIdx;   // default: this league's own length

        let typeLeagues = [];
        let rows = [];
        function repool() {
            typeLeagues = sameTypeLeagues.filter(l =>
                nearestMatchLengthIdx(l.params.MatchLength || 7) === poolMlIdx);
            rows = [];
            for (const league of typeLeagues) {
                for (const m of buildGeneralAdvantageSeries(league.matches)) {
                    rows.push({ ...m, mlIdx: poolMlIdx });
                }
            }
        }
        repool();

        const labelEl = allTimePanel.querySelector('.corr-alltime-label');
        if (!rows.length) {
            labelEl.textContent = 'All League Matches — no data yet';
            return;
        }

        const showLenInLabel = lenIdxSet.size > 1;
        let fullBound = domain.xMax;
        // Re-fit the shared domain to the current pool (only ever expands it, so
        // the current-league row above stays aligned) and refresh the label.
        // Returns whether the shared domain grew, so the general row can redraw.
        function applyPoolDomain() {
            let maxAbs = 0;
            for (const r of rows) maxAbs = Math.max(maxAbs, Math.abs(r.advantage));
            const expanded = Math.max(domain.xMax, Math.ceil(maxAbs));
            const grew = expanded > domain.xMax;
            if (grew) { domain.xMin = -expanded; domain.xMax = expanded; }
            fullBound = domain.xMax;
            const lenTxt = showLenInLabel ? ` — ${matchLengthForIdx(poolMlIdx)} pt` : '';
            labelEl.textContent = `All League Matches${lenTxt} (${rows.length} matches, ${typeLeagues.length} league${typeLeagues.length === 1 ? '' : 's'})`;
            return grew;
        }
        const domainChanged = applyPoolDomain();
        const shiftAmountEl = allTimePanel.querySelector('.corr-shift-amount');
        const trimToggle = allTimePanel.querySelector('.corr-trim-toggle');
        const host = allTimePanel.querySelector('.corr-host');
        const [minusBtn, plusBtn] = allTimePanel.querySelectorAll('.corr-shift-btn');

        // Trim view is independent of the shared `domain` — toggling it only
        // narrows the X-axis (dropping outlier bins entirely, not folding
        // them into the edge) for THIS row's own display. The Gaussian fit
        // and Table Validation table always recompute over the full,
        // untrimmed `rows` data below, so trimming never changes them.
        // (`fullBound` is declared above and re-fitted by applyPoolDomain().)
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
                // μ/σ describe the raw PR-gap distribution, which is
                // length-independent; the pool already holds a single length.
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
            explanationToggle.textContent = enoughForGaussian ? 'Table Validation' : 'Table Validation (not enough data)';
            explanationToggle.title = enoughForGaussian
                ? 'Compares this row\'s real data against the win-probability table, gap by gap, with a likelihood check on how surprising each row\'s result is.'
                : `Needs at least ${MIN_GAUSSIAN_N} matches before this comparison is meaningful.`;
            if (!enoughForGaussian) showExplanation = false;
            explanationToggle.classList.toggle('is-active', showExplanation);

            if (showExplanation) {
                // Compared against the selected pool length (poolMlIdx) — the
                // aggregate only ever holds one length at a time, so the table
                // column it is validated against is exactly that length.
                explanationPopup.innerHTML = buildExplanationTableHtml(rows, shift, poolMlIdx);
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

        // Match-length selector — switch which single length's aggregate is
        // shown (default: this league's own length). No "All lengths" option:
        // this row is validated against one table column, so pooling lengths
        // would be meaningless here. Shown only when >1 length exists.
        if (lenIdxSet.size > 1) {
            const lenHost = document.createElement('div');
            lenHost.className = 'corr-length-select';
            allTimePanel.querySelector('.corr-controls').appendChild(lenHost);
            mountLengthSelector(lenHost, {
                lengths: [...lenIdxSet].map(i => matchLengthForIdx(i)),
                defaultLen: matchLengthForIdx(generalMlIdx),
                includeAll: false,
                onSelect: (len) => {
                    poolMlIdx = len == null ? generalMlIdx : nearestMatchLengthIdx(len);
                    repool();
                    if (applyPoolDomain()) redrawGeneral();
                    redrawAllTime();
                },
            });
        }
    });
}
