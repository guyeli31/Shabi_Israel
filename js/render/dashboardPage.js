/**
 * dashboardPage.js — League Dashboard (Phase F).
 * F1: summary cards (with leader flag)
 * F2: historical view — defaults to current state showing medal winners only
 * F3: rounds navigator — all matches incl. unplayed, with "played on" column
 * F4: player picker + interactive bar chart, with multi-chart compare
 * Plus: prev/next league navigation arrows in the header.
 */

import { loadLeagueParams, loadLeagueOrder, loadOverrides, loadAllLeagueParams, applyOverrides } from '../data/leagueLoader.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { loadMatchHistory, getMatchesAsOf, getUpdateDates, mergeHistoryIntoMatches, matchKey } from '../compute/matchHistory.js';
import { parseCSVAllWithRounds, parseCSV, getAllPlayersFromCSV } from '../data/csvParser.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, formatPercent, formatNumber, leagueUrl, playerUrl, dashboardUrl, flagUrl, getFlagCode, thLabel, appendExportCredit } from '../utils/helpers.js';
import { colorForValueInverted } from '../compute/colorScale.js';
import { drawPlayerBarChart } from './playerBarChart.js';
import { renderBreadcrumbs } from './navigation.js';
import { predictChampionship, computeTopXPct } from '../compute/championshipPredictor.js';
import { batchLast300PR } from '../compute/crossLeague.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { startSplash, endSplash } from '../utils/splash.js';

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
        const encoded = encodeURIComponent(leagueId);
        const csvResp = await fetch(`leagues/${encoded}/leaguedata.csv`);
        const csvText = await csvResp.text();
        const lastModified = csvResp.headers.get('Last-Modified') || null;

        const [params, overrides, history, leagueOrder, playersMeta] = await Promise.all([
            loadLeagueParams(leagueId),
            loadOverrides(leagueId),
            loadMatchHistory(leagueId),
            loadLeagueOrder().catch(() => []),
            loadPlayersMetadata()
        ]);

        // Per-type navigation requires params of all leagues
        const folderNamesAll = (leagueOrder || []).map(t => t.replace(' - ', ' '));
        let allParams = [];
        try {
            allParams = await loadAllLeagueParams(folderNamesAll);
        } catch { allParams = []; }

        const title = params.LeagueTitle || leagueId;
        document.getElementById('page-title').textContent = `${title}`;
        document.title = `${title} — Dashboard`;

        // Status pill — inline after title text
        const titleEl = document.getElementById('page-title');
        const statusSpan = document.createElement('span');
        statusSpan.style.cssText = 'margin-left:10px;vertical-align:middle;font-size:0.75rem;';
        statusSpan.innerHTML = params.Running
            ? '<span class="status-pill status-running">Running</span>'
            : '<span class="status-pill status-completed">Completed</span>';
        titleEl.appendChild(statusSpan);

        // Breadcrumbs
        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title }
        ]);

        installLeagueNavArrows(leagueId, allParams, params.LeagueType || 'doubling');

        // Parse CSV — both with-unplayed and only-played variants
        const parsedAll = parseCSVAllWithRounds(csvText);
        const allMatchesIncUnplayedRaw = parsedAll.matches;
        const playedMatchesRaw = parseCSV(csvText);
        const allPlayersSet = getAllPlayersFromCSV(csvText);

        // Apply manual overrides (consistency with league table)
        const playedMatches = applyOverrides(playedMatchesRaw, overrides);
        const allMatchesIncUnplayed = applyOverridesToAll(allMatchesIncUnplayedRaw, overrides);

        const leagueConfig = getLeagueConfig(params);
        const liveMatches = mergeHistoryIntoMatches(playedMatches, history.matches);

        const ctx = {
            leagueId, params, leagueConfig, lastModified,
            allMatchesIncUnplayed, playedMatches, liveMatches, allPlayersSet,
            roundCount: parsedAll.roundCount,
            history, playersMeta
        };

        container.innerHTML = renderShell();
        renderSummaryCards(ctx);
        renderPrizes(ctx);
        renderHistorical(ctx);
        renderPredictor(ctx); // async — fills in after data loads
        renderWhatIfSimulator(ctx);
        renderRounds(ctx);
        renderRemainingMatches(ctx);
        renderPlayerSection(ctx);
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
        <a class="nav-arrow ${prev ? '' : 'disabled'}" ${prev ? `href="${dashboardUrl(prev)}" title="Previous league: ${prev}"` : 'title="No previous league"'}>&lsaquo;</a>
        <a class="nav-arrow ${next ? '' : 'disabled'}" ${next ? `href="${dashboardUrl(next)}" title="Next league: ${next}"` : 'title="No next league"'}>&rsaquo;</a>
    `;
    header.querySelector('h1').insertAdjacentElement('afterend', nav);
}

function renderShell() {
    return `
        <div class="dashboard-cards" id="dash-cards"></div>

        <section class="dash-section" id="prizes-section" style="display:none">
            <h2>
                <button class="prizes-toggle-btn" id="prizes-toggle">Prizes &amp; Medals</button>
            </h2>
            <div id="prizes-content" hidden></div>
        </section>

        <section class="dash-section">
            <h2>Historical view</h2>
            <div class="dash-controls">
                <button id="hist-prev" title="Previous snapshot">&lsaquo;</button>
                <select id="hist-date" title="Select snapshot date"></select>
                <button id="hist-next" title="Next snapshot">&rsaquo;</button>
                <a id="hist-to-full" class="open-full-btn" href="#" title="Open the full league table for the current state">Open full table &rsaquo;</a>
            </div>
            <div id="hist-table"></div>
        </section>

        <section class="dash-section" id="predictor-section" style="display:none">
            <h2>Championship Predictor
                <span class="predictor-tooltip" id="predictor-info-btn">?</span>
            </h2>
            <div class="predictor-info-popup" id="predictor-info-popup" hidden>
                <button class="predictor-info-close" id="predictor-info-close">&times;</button>
                <h3>How It Works</h3>
                <p>The predictor simulates all remaining matches to estimate each player's probability of winning the championship.</p>
                <h4>Simulation Method</h4>
                <ul>
                    <li><b>Doubling / Regular leagues:</b> <b>Exact enumeration</b> when ≤20 matches remain (every 2<sup>N</sup> outcome is evaluated with its exact probability weight); <b>Monte Carlo</b> when &gt;20 remain.</li>
                    <li><b>UBC leagues:</b> Always <b>Monte Carlo</b> — because PR-win outcomes are probabilistic (see below), exact enumeration would require 4<sup>N</sup> scenarios and is not feasible.</li>
                </ul>
                <h4>Win Probability Per Match</h4>
                <p>Each match outcome is determined by the PR gap between the two players, using each player's <b>Last-300 PR</b> (their calibrated strength over the last 300 rated matches) — not their current league performance. A calibrated lookup table maps the rounded PR difference to a win probability for the stronger (lower-PR) player; for gaps beyond 10, linear extrapolation from rows 9–10 is applied and clamped to [50%, 99.9%]. If a player has no Last-300 PR, their current league mean PR is used as a fallback (or 10.0 if neither exists). Current-league mean PR only influences the <b>tiebreaker</b> — see "Determining the Champion".</p>
                <h4>PR Win Point (UBC only)</h4>
                <p>In UBC leagues, each match awards up to 2 points: 1 for match win + 1 for <b>PR win</b> (lower PR in the match). The predictor models each player's per-match PR as a normal distribution N(μ, σ) using their Last-300 mean and standard deviation. The probability that player A wins the PR point is:</p>
                <p style="text-align:center"><code><b>P(A wins PR) = Φ((μ<sub>B</sub> − μ<sub>A</sub>) / √(σ<sub>A</sub>² + σ<sub>B</sub>²))</b></code></p>
                <p>where Φ is the standard normal CDF. This correctly captures that a small PR advantage does <i>not</i> guarantee the PR point — it only shifts the probability. When fewer than 3 matches are available for STD estimation, a default of 2.0 is used.</p>
                <h4>Determining the Champion</h4>
                <p>After simulating all remaining matches, the final standings are ranked using the league's scoring rules (Win Rate, Points, etc.). The tiebreaker is a <b>blended Mean PR</b>: games already played contribute at the player's current league mean PR, while remaining games are assumed to be played at the player's Last-300 PR level (reflecting regression toward true strength, lower is better). The championship percentage shows how often each player finishes 1st across all simulated seasons.</p>
                <h4>Margin of Error</h4>
                <p>For Monte Carlo results, the margin of error is a 95% confidence interval on the leading player's championship probability, computed from the binomial sampling distribution:</p>
                <p style="text-align:center"><code><b>MoE = 1.96 × √(p × (1 − p) / N) × 100%</b></code></p>
                <p>where <i>p</i> is the leader's estimated probability and <i>N</i> is the number of simulated seasons. It reflects sampling uncertainty only. Exact enumeration has no margin of error because every scenario is evaluated deterministically.</p>
            </div>
            <div class="predictor-moe" id="predictor-moe"></div>
            <div class="predictor-topx-control" id="predictor-topx-wrap" style="display:none">
                <label for="predictor-topx-input">Show</label>
                <select id="predictor-topx-input" class="topx-select"></select>
            </div>
            <div id="predictor-table"><div class="loading">Computing predictions...</div></div>
            <button id="predictor-expand" class="predictor-expand-btn" style="display:none">Show Full Table</button>

            <div class="whatif-wrap" id="whatif-wrap" style="display:none">
                <h3 id="whatif-header" class="whatif-header">
                    <span id="whatif-arrow">&#x25B8;</span>
                    <span>&#x1F9EA; What If Simulator</span>
                    <span class="whatif-tooltip" id="whatif-info-btn">?</span>
                </h3>
                <div class="whatif-info-popup" id="whatif-info-popup" hidden>
                    <button class="whatif-info-close" id="whatif-info-close">&times;</button>
                    <h4>What If Simulator</h4>
                    <p>Pick any scheduled match in the league and force its outcome (A wins, B wins, or Not Played). Add as many matches as you like, then <b>Run Simulation</b> to see how the championship odds would change in that alternate scenario.</p>
                    <ul>
                        <li>Already-played matches load with their real result and can be overridden.</li>
                        <li>Unplayed matches start as <i>Not Played</i> — pick a winner to lock the outcome.</li>
                        <li>Player B's search narrows to players who share a scheduled match with Player A.</li>
                    </ul>
                    <p>The engine is the same as the real predictor above — only the inputs differ. Results are speculative and depend on your choices.</p>
                </div>
                <div id="whatif-body" hidden>
                    <div class="whatif-picker">
                        <input type="text" id="whatif-input-a" class="whatif-input" placeholder="Player A" autocomplete="off" list="whatif-list-a">
                        <datalist id="whatif-list-a"></datalist>
                        <span class="whatif-vs">vs</span>
                        <input type="text" id="whatif-input-b" class="whatif-input" placeholder="Player B" autocomplete="off" list="whatif-list-b">
                        <datalist id="whatif-list-b"></datalist>
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
            </div>
        </section>

        <section class="dash-section">
            <h2>Rounds</h2>
            <div class="dash-controls">
                <button id="round-prev" title="Previous round">&lsaquo;</button>
                <span class="round-label" id="round-label">Round 1 / 1</span>
                <button id="round-next" title="Next round">&rsaquo;</button>
                <button id="round-all" title="Show all rounds">All</button>
            </div>
            <div id="round-table"></div>
        </section>

        <section class="dash-section" id="remaining-section">
            <h2>
                Remaining Matches
                <span id="remaining-count" style="font-size:0.8em;color:var(--color-text-muted);font-weight:normal"></span>
            </h2>
            <div class="rem-tab-bar">
                <button class="rem-tab-btn" data-panel="rem-panel-b6a"><span class="rem-tab-arrow">&#x25B8;</span> All Remaining</button>
                <button class="rem-tab-btn" data-panel="rem-panel-b6b"><span class="rem-tab-arrow">&#x25B8;</span> Remaining Report</button>
                <button class="rem-tab-btn" data-panel="rem-panel-b6c"><span class="rem-tab-arrow">&#x25B8;</span> Per Player</button>
            </div>
            <div id="rem-panel-b6a" class="rem-tab-panel" hidden></div>
            <div id="rem-panel-b6b" class="rem-tab-panel" hidden></div>
            <div id="rem-panel-b6c" class="rem-tab-panel" hidden></div>
        </section>

        <section class="dash-section">
            <h2>Player insights</h2>
            <div id="charts-container"></div>
            <button id="add-chart" class="add-chart-btn" title="Add another chart for comparison">+ Add chart</button>
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
    const startDate = params.StartDate
        ? new Date(params.StartDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'N/A';

    const typeLabels = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
    const typeLabel = typeLabels[params.LeagueType] || (params.LeagueType || 'Doubling');

    const cards = [
        { label: 'League Type', value: typeLabel },
        { label: 'Games Played', value: `${matchStats.playedMatches} / ${matchStats.totalMatches}` }
    ];
    if (leagueConfig.showPR) cards.push({ label: 'Average PR', value: avgPR });
    cards.push(
        { label: 'Leading Player', value: leaderHtml },
        { label: 'Start Date', value: startDate }
    );

    const cardsHost = document.getElementById('dash-cards');
    cardsHost.innerHTML = cards.map(c => `
        <div class="dash-card">
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
    const toggleBtn = document.getElementById('prizes-toggle');
    section.style.display = '';

    const entryFee = params.EntryFee != null ? params.EntryFee : '—';
    const rows = [];
    if (params.GoldCount) rows.push({ medal: '🥇', tier: 'Gold', count: params.GoldCount, prize: prizes.Gold != null ? `₪${prizes.Gold.toLocaleString()}` : '—' });
    if (params.SilverCount) rows.push({ medal: '🥈', tier: 'Silver', count: params.SilverCount, prize: prizes.Silver != null ? `₪${prizes.Silver.toLocaleString()}` : '—' });
    if (params.BronzeCount) rows.push({ medal: '🥉', tier: 'Bronze', count: params.BronzeCount, prize: prizes.Bronze != null ? `₪${prizes.Bronze.toLocaleString()}` : '—' });

    let html = `<div class="prizes-info"><span class="prizes-entry">Entry Fee: <b>₪${entryFee}</b></span></div>`;
    html += '<div class="prizes-table-wrap"><table class="dash-table prizes-table font-small"><thead><tr><th scope="col"></th><th scope="col">Tier</th><th scope="col">Places</th><th scope="col">Prize</th></tr></thead><tbody>';
    for (const r of rows) {
        html += `<tr class="prize-row-${r.tier.toLowerCase()}"><td>${r.medal}</td><td>${r.tier}</td><td>${r.count}</td><td>${r.prize}</td></tr>`;
    }
    html += '</tbody></table></div>';
    content.innerHTML = html;

    toggleBtn.addEventListener('click', () => {
        content.hidden = !content.hidden;
        toggleBtn.classList.toggle('prizes-toggle-open', !content.hidden);
    });
}

// ---------- F2 ----------
function renderHistorical(ctx) {
    const { history, lastModified, leagueId } = ctx;
    const select = document.getElementById('hist-date');
    const prevBtn = document.getElementById('hist-prev');
    const nextBtn = document.getElementById('hist-next');
    const fullLink = document.getElementById('hist-to-full');
    fullLink.href = leagueUrl(leagueId);

    const historyDates = getUpdateDates(history); // descending
    // Build options: "Current" first (always), then history dates
    const currentLabel = lastModified
        ? `Current (Last updated: ${formatLastModified(lastModified)})`
        : 'Current';
    const options = [{ value: '__current__', label: currentLabel }];
    for (const d of historyDates) options.push({ value: d, label: d });

    select.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    function update() {
        const idx = select.selectedIndex;
        prevBtn.disabled = idx <= 0;
        nextBtn.disabled = idx >= options.length - 1;
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
        const cutoff = dateValue + 'T23:59:59Z';
        matchesForView = getMatchesAsOf(history, cutoff);
    }

    const statsMap = computeAllStats(matchesForView, allPlayersSet);
    const rankings = buildRankings(statsMap, leagueConfig, matchesForView);

    const goldCount = params.GoldCount || 1;
    const silverCount = params.SilverCount || 1;
    const bronzeCount = params.BronzeCount || 4;
    const medalLimit = goldCount + silverCount + bronzeCount;
    const top = rankings.filter(r => r.rank <= medalLimit && r.games > 0);

    function rankClass(rank) {
        if (rank <= goldCount) return 'rank-gold';
        if (rank <= goldCount + silverCount) return 'rank-silver';
        if (rank <= medalLimit) return 'rank-bronze';
        return '';
    }

    let html = `<table class="dash-table font-large"><thead><tr><th scope="col">#</th><th scope="col" class="player-col">Player</th><th scope="col">GP</th><th scope="col">W</th><th scope="col">L</th>`;
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
    attachStickyShadow(host.querySelector('.dash-table-wrap'));
}

// ---------- Championship Predictor ----------
function ensureLast300Map(ctx) {
    if (!ctx._last300MapPromise) {
        ctx._last300MapPromise = batchLast300PR([...ctx.allPlayersSet], ctx.leagueConfig.type);
    }
    return ctx._last300MapPromise;
}

async function renderPredictor(ctx) {
    const section = document.getElementById('predictor-section');
    const host = document.getElementById('predictor-table');
    const moeHost = document.getElementById('predictor-moe');
    const expandBtn = document.getElementById('predictor-expand');

    // Only show for running leagues
    if (ctx.params.Running !== true) return;
    section.style.display = '';

    // Wire info popup toggle
    const infoBtn = document.getElementById('predictor-info-btn');
    const infoPopup = document.getElementById('predictor-info-popup');
    const infoClose = document.getElementById('predictor-info-close');
    if (infoBtn && infoPopup) {
        infoBtn.addEventListener('click', () => { infoPopup.hidden = !infoPopup.hidden; });
        if (infoClose) infoClose.addEventListener('click', () => { infoPopup.hidden = true; });
    }

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
            allPlayers: ctx.allPlayersSet
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
                const barColor = pct > Math.min(20 * currentX, 80) ? 'var(--color-success)' : pct > Math.min(5 * currentX, 30) ? 'var(--color-warning)' : 'var(--color-text-muted)';
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
                <table class="dash-table font-small">
                    <thead><tr>
                        <th scope="col">#</th><th scope="col" class="player-col">Player</th><th scope="col">GP</th><th scope="col">W</th><th scope="col">L</th>
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
    if (ctx.params.Running !== true) return;
    const wrap = document.getElementById('whatif-wrap');
    if (!wrap) return;
    wrap.style.display = '';

    const header = document.getElementById('whatif-header');
    const arrow = document.getElementById('whatif-arrow');
    const body = document.getElementById('whatif-body');
    const infoBtn = document.getElementById('whatif-info-btn');
    const infoPopup = document.getElementById('whatif-info-popup');
    const infoClose = document.getElementById('whatif-info-close');
    const inputA = document.getElementById('whatif-input-a');
    const inputB = document.getElementById('whatif-input-b');
    const listA = document.getElementById('whatif-list-a');
    const listB = document.getElementById('whatif-list-b');
    const addBtn = document.getElementById('whatif-add');
    const addErr = document.getElementById('whatif-add-err');
    const stagedHost = document.getElementById('whatif-staged');
    const runBtn = document.getElementById('whatif-run');
    const clearBtn = document.getElementById('whatif-clear');
    const output = document.getElementById('whatif-output');
    const moeHost = document.getElementById('whatif-moe');
    const tableHost = document.getElementById('whatif-table');
    const expandBtn = document.getElementById('whatif-expand');

    // Collapse toggle
    header.addEventListener('click', (e) => {
        if (e.target === infoBtn) return;
        const collapsed = body.hidden;
        body.hidden = !collapsed;
        arrow.innerHTML = collapsed ? '&#x25BE;' : '&#x25B8;';
    });

    // Info popup
    if (infoBtn && infoPopup) {
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            infoPopup.hidden = !infoPopup.hidden;
        });
    }
    if (infoClose) infoClose.addEventListener('click', () => { infoPopup.hidden = true; });

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
    listA.innerHTML = allPlayersSorted.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');

    function refreshListB() {
        const a = inputA.value.trim();
        let options = [];
        if (a && opponentsOf.has(a)) {
            options = [...opponentsOf.get(a)].filter(p => p !== 'Bye' && p !== a).sort();
        } else {
            options = allPlayersSorted;
        }
        listB.innerHTML = options.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');
    }
    inputA.addEventListener('input', refreshListB);
    refreshListB();

    // State: staged matches
    const staged = []; // { a, b, key, result: 'NP'|'A'|'B', realWinner: 'A'|'B'|null, wasPlayed: bool }

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
        refreshListB();
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
                allPlayers: ctx.allPlayersSet
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
            wiTopXInput.value = 1;
            let currentX = 1;

            const getTopXPct = (r) =>
                computeTopXPct(result.finishRankCounts, r.playerIdx, result.n, result.totalWeight, currentX);

            wiTopXInput.addEventListener('change', () => {
                currentX = parseInt(wiTopXInput.value);
                renderTable(expanded);
            });

            const showPR = ctx.leagueConfig.showPR;
            const showPRWins = ctx.leagueConfig.showPRWins;
            let expanded = false;
            const renderTable = (full) => {
                const sorted = [...result.rankings].sort((a, b) => getTopXPct(b) - getTopXPct(a));
                const data = full ? sorted : sorted.slice(0, 5);
                const rows = data.map((r, i) => {
                    const flagCode = getFlagCode(r.player, ctx.params.CustomFlags);
                    const pct = getTopXPct(r);
                    const barColor = pct > Math.min(20 * currentX, 80) ? 'var(--color-success)' : pct > Math.min(5 * currentX, 30) ? 'var(--color-warning)' : 'var(--color-text-muted)';
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
                    <table class="dash-table whatif-table font-small">
                        <thead><tr>
                            <th scope="col">#</th><th scope="col" class="player-col">Player</th><th scope="col">GP</th><th scope="col">W</th><th scope="col">L</th>
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
    let html = `<div class="rounds-scroll-wrap"><table class="dash-table font-small"><thead><tr>`
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

    // Sub-tab toggle — one panel open at a time; clicking an open tab closes it
    const buttons = document.querySelectorAll('#remaining-section .rem-tab-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            const panel = document.getElementById(panelId);
            if (!panel) return;
            const opening = panel.hidden;

            // Close all panels
            buttons.forEach(b => {
                const p = document.getElementById(b.dataset.panel);
                if (p) p.hidden = true;
                b.classList.remove('rem-tab-btn--open');
                const arr = b.querySelector('.rem-tab-arrow');
                if (arr) arr.innerHTML = '&#x25B8;';
            });

            if (!opening) return; // was open — close it

            panel.hidden = false;
            btn.classList.add('rem-tab-btn--open');
            const arrow = btn.querySelector('.rem-tab-arrow');
            if (arrow) arrow.innerHTML = '&#x25BE;';

            if (!panel._built) {
                panel._built = true;
                if (panelId === 'rem-panel-b6a') buildB6aPanel(panel, remaining, params, playersMeta, lastModified);
                else if (panelId === 'rem-panel-b6b') buildB6bPanel(panel, ctx, remaining, lastModified);
                else if (panelId === 'rem-panel-b6c') buildB6cPanel(panel, ctx, remaining, lastModified);
            }
        });
    });
}

function buildB6aPanel(panel, remaining, params, playersMeta, lastModified) {
    if (remaining.length > 0) {
        const exportRow = document.createElement('div');
        exportRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:var(--space-sm);';
        const exportBtn = document.createElement('button');
        exportBtn.className = 'img-export-btn';
        exportBtn.textContent = 'Export Image';
        exportRow.appendChild(exportBtn);
        panel.appendChild(exportRow);
        exportBtn.addEventListener('click', () => {
            exportRemainingMatchesImage(params.LeagueTitle || '', remaining, params.CustomFlags, playersMeta, lastModified);
        });
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

    const exportRow = document.createElement('div');
    exportRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:var(--space-sm);';
    const exportBtn = document.createElement('button');
    exportBtn.className = 'img-export-btn';
    exportBtn.textContent = 'Export Image';
    exportRow.appendChild(exportBtn);
    panel.appendChild(exportRow);

    const wrap = document.createElement('div');
    wrap.className = 'rem-b6b-wrap';
    wrap.innerHTML = buildB6bTableHtml(playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames);
    panel.appendChild(wrap);

    exportBtn.addEventListener('click', () => {
        exportB6bImage(params.LeagueTitle || ctx.leagueId, playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames, lastModified);
    });
}

function buildB6bTableHtml(playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames) {
    let html = '<table class="dash-table font-small player-remaining-table"><thead><tr>'
        + '<th scope="col" class="player-col">Player</th>'
        + '<th scope="col">Remaining</th>'
        + '</tr></thead><tbody>';
    let separatorInserted = false;
    for (const p of playerRemainingData) {
        if (!separatorInserted && hasAnyBelowHalf && p.games > halfThreshold) {
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
                <input type="text" id="rem-b6c-input" class="rem-b6c-input"
                    placeholder="Search player…" autocomplete="off" list="rem-b6c-list">
                <datalist id="rem-b6c-list">
                    ${allPlayers.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}
                </datalist>
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
            <div class="rem-b6c-export-row">
                <button class="img-export-btn" id="rem-b6c-export-btn">Export Image</button>
            </div>
            <div class="rem-b6c-wrap">${buildB6cTableHtml(opponents, params.CustomFlags, playersMeta)}</div>`;

        result.querySelector('#rem-b6c-export-btn').addEventListener('click', () => {
            exportB6cImage(title, player, opponents, params.CustomFlags, playersMeta, lastModified);
        });
    }

    input.addEventListener('input', () => showPlayer(input.value));
    input.addEventListener('change', () => showPlayer(input.value));
}

function buildB6cTableHtml(opponents, customFlags, playersMeta) {
    if (opponents.length === 0) {
        return `<div style="color:var(--color-text-muted);padding:var(--space-sm);text-align:center">All matches played!</div>`;
    }
    let html = '<table class="dash-table font-small rem-b6c-table"><thead><tr>'
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
    let html = `<table class="dash-table font-small"><thead><tr>`
             + `<th scope="col">Round</th>`
             + `<th scope="col" class="player-col">Player A</th>`
             + `<th scope="col" class="player-col">Player B</th>`
             + `</tr></thead><tbody>`;
    for (const m of matches) {
        const flagA = getFlagCode(m.playerA, customFlags);
        const flagB = getFlagCode(m.playerB, customFlags);
        const titlesA = getTitleAbbreviationsHtml(playersMeta[m.playerA]);
        const titlesB = getTitleAbbreviationsHtml(playersMeta[m.playerB]);
        html += `<tr class="unplayed-row">`
             +  `<td>${m.round}</td>`
             +  `<td class="player-cell"><img class="flag" src="${flagUrl(flagA)}" alt="${flagA}"> ${m.playerA}${titlesA}</td>`
             +  `<td class="player-cell"><img class="flag" src="${flagUrl(flagB)}" alt="${flagB}"> ${m.playerB}${titlesB}</td>`
             +  `</tr>`;
    }
    html += '</tbody></table>';
    return html;
}

async function exportRemainingMatchesImage(title, matches, customFlags, playersMeta, lastModified) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }
    const bodyStyle = getComputedStyle(document.body);
    const asOf = lastModified
        ? `As of ${new Date(lastModified).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : '';
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-10000px;top:0;padding:24px;background:${bodyStyle.backgroundColor};color:${bodyStyle.color};font-family:${bodyStyle.fontFamily};min-width:560px;`;
    wrap.innerHTML = `
        <h3 style="margin:0 0 4px 0;font-size:20px;">${escapeHtml(title)}</h3>
        <div style="margin:0 0 12px 0;font-size:13px;opacity:0.75">Remaining Matches (${matches.length})${asOf ? ' \u2014 ' + asOf : ''}</div>
        ${buildRemainingListHtml(matches, customFlags, playersMeta)}`;
    document.body.appendChild(wrap);
    appendExportCredit(wrap);
    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: null, useCORS: true });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_Remaining.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}

async function exportB6bImage(title, playerRemainingData, maxRem, minRem, halfThreshold, hasAnyBelowHalf, maxGames, lastModified) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }
    const bodyStyle = getComputedStyle(document.body);
    const docStyle = getComputedStyle(document.documentElement);
    const bgColor = bodyStyle.backgroundColor;
    const textColor = bodyStyle.color;
    const borderColor = docStyle.getPropertyValue('--color-border').trim() || '#e2e4e9';
    const headerBg = docStyle.getPropertyValue('--header-bg').trim() || '#1e293b';
    const headerText = docStyle.getPropertyValue('--header-text').trim() || '#f8fafc';
    const mutedColor = docStyle.getPropertyValue('--color-text-muted').trim() || '#6b6d84';
    const asOf = lastModified
        ? `As of ${new Date(lastModified).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : '';

    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-10000px;top:0;padding:24px;background:${bgColor};color:${textColor};font-family:${bodyStyle.fontFamily};min-width:380px;`;

    let html = `<h3 style="margin:0 0 4px 0;font-size:18px;color:${textColor}">${escapeHtml(title)}</h3>`
        + `<div style="margin:0 0 12px 0;font-size:13px;color:${mutedColor}">Remaining Matches Report${asOf ? ' \u2014 ' + asOf : ''}</div>`
        + `<table style="width:100%;border-collapse:collapse;font-size:14px;">`
        + `<thead><tr>`
        + `<th style="text-align:left;padding:7px 12px;background:${headerBg};color:${headerText}">Player</th>`
        + `<th style="text-align:center;padding:7px 12px;background:${headerBg};color:${headerText}">Remaining / Total</th>`
        + `</tr></thead><tbody>`;

    let separatorInserted = false;
    for (const p of playerRemainingData) {
        if (!separatorInserted && hasAnyBelowHalf && p.games > halfThreshold) {
            html += `<tr><td colspan="2" style="padding:3px 12px;border-top:2px dashed ${borderColor};font-size:11px;color:${mutedColor};text-align:center;font-style:italic;font-weight:700;">&#8212; played &ge; half &#8212;</td></tr>`;
            separatorInserted = true;
        }
        const isBold = !separatorInserted;
        const color = colorForValueInverted(p.remaining, minRem, maxRem);
        const rowBorder = `border-bottom:1px solid ${borderColor}`;
        const boldStyle = isBold ? 'font-weight:700' : '';
        html += `<tr>`
            + `<td style="text-align:left;padding:6px 12px;${rowBorder};${boldStyle}">`
            + `<img src="${flagUrl(p.flagCode)}" alt="${p.flagCode}" style="height:12px;border-radius:2px;vertical-align:middle;margin-right:6px">`
            + `${escapeHtml(p.player)}</td>`
            + `<td style="text-align:center;padding:6px 12px;${rowBorder};${boldStyle};color:${color}">${p.remaining} / ${maxGames}</td>`
            + `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    appendExportCredit(wrap);
    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: null, useCORS: true });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_Remaining_Report.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}

async function exportB6cImage(title, player, opponents, customFlags, playersMeta, lastModified) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }
    const bodyStyle = getComputedStyle(document.body);
    const docStyle = getComputedStyle(document.documentElement);
    const bgColor = bodyStyle.backgroundColor;
    const textColor = bodyStyle.color;
    const borderColor = docStyle.getPropertyValue('--color-border').trim() || '#e2e4e9';
    const headerBg = docStyle.getPropertyValue('--header-bg').trim() || '#1e293b';
    const headerText = docStyle.getPropertyValue('--header-text').trim() || '#f8fafc';
    const mutedColor = docStyle.getPropertyValue('--color-text-muted').trim() || '#6b6d84';
    const asOf = lastModified
        ? `As of ${new Date(lastModified).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : '';

    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-10000px;top:0;padding:24px;background:${bgColor};color:${textColor};font-family:${bodyStyle.fontFamily};min-width:280px;`;

    let html = `<h3 style="margin:0 0 4px 0;font-size:18px;color:${textColor}">${escapeHtml(title)}</h3>`
        + `<div style="margin:0 0 4px 0;font-size:14px;color:${textColor};font-weight:700">${escapeHtml(player)}</div>`
        + `<div style="margin:0 0 12px 0;font-size:12px;color:${mutedColor}">${opponents.length} remaining match${opponents.length !== 1 ? 'es' : ''}${asOf ? ' \u2014 ' + asOf : ''}</div>`;

    if (opponents.length === 0) {
        html += `<div style="color:${mutedColor};font-size:13px">All matches played!</div>`;
    } else {
        html += `<table style="width:100%;border-collapse:collapse;font-size:14px;">`
            + `<thead><tr><th style="text-align:left;padding:7px 12px;background:${headerBg};color:${headerText}">Unplayed Opponent</th></tr></thead><tbody>`;
        for (const opp of opponents) {
            const flagCode = getFlagCode(opp, customFlags);
            html += `<tr><td style="text-align:left;padding:6px 12px;border-bottom:1px solid ${borderColor}">`
                + `<img src="${flagUrl(flagCode)}" alt="${flagCode}" style="height:12px;border-radius:2px;vertical-align:middle;margin-right:6px">`
                + `${escapeHtml(opp)}</td></tr>`;
        }
        html += '</tbody></table>';
    }

    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    appendExportCredit(wrap);
    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: null, useCORS: true });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_${player.replace(/\s+/g, '_')}_Remaining.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}

// ---------- F4 ----------
function renderPlayerSection(ctx) {
    const { allPlayersSet, liveMatches, leagueId } = ctx;
    const players = [...allPlayersSet].sort();
    const totalMatchesPerPlayer = players.length - 1;

    const container = document.getElementById('charts-container');

    function buildPanel(initialPlayer) {
        const panel = document.createElement('div');
        panel.className = 'chart-panel';
        panel.innerHTML = `
            <div class="dash-controls">
                <label>Player:</label>
                <select class="player-pick">${players.map(p => `<option value="${p}" ${p === initialPlayer ? 'selected' : ''}>${p}</option>`).join('')}</select>
                <label>Metric:</label>
                <select class="metric-pick">
                    <option value="pr">PR</option>
                    <option value="luck">Luck</option>
                </select>
                <a class="forward-link player-card-link" href="#" title="Open full player card">Open player card &rsaquo;</a>
                <button class="remove-chart" title="Remove this chart" style="margin-left:auto">&times;</button>
            </div>
            <div class="chart-host"></div>
        `;
        container.appendChild(panel);

        const playerSel = panel.querySelector('.player-pick');
        const metricSel = panel.querySelector('.metric-pick');
        const link = panel.querySelector('.player-card-link');
        const host = panel.querySelector('.chart-host');
        const removeBtn = panel.querySelector('.remove-chart');

        function update() {
            const player = playerSel.value;
            link.href = playerUrl(leagueId, player);
            const matches = buildPlayerSeries(liveMatches, player);
            drawPlayerBarChart(host, matches, metricSel.value, totalMatchesPerPlayer);
        }
        playerSel.addEventListener('change', update);
        metricSel.addEventListener('change', update);
        removeBtn.addEventListener('click', () => {
            if (container.children.length > 1) panel.remove();
        });
        update();
    }

    buildPanel(players[0]);

    document.getElementById('add-chart').addEventListener('click', () => {
        buildPanel(players[0]);
    });
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
