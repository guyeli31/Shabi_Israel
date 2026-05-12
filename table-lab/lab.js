/**
 * lab.js — Preset definitions and UI wiring for the MF Table Lab.
 *
 * Data is loaded live from the real project modules via lab-loader.js.
 * Each PRESET holds the static config (fontClass, stickyCols, argDocs …)
 * and receives data/cols/summary after the async load completes.
 */

import { mountMFTable } from './formats/mf/mount.js';
import { loadAllPresetData } from './lab-loader.js';
import { initThemePicker } from '../js/render/themePicker.js';

// ─────────────────────────────────────────────
// Argument documentation (shared vocabulary)
// ─────────────────────────────────────────────

const ARG_DOCS_BASE = {
    fontClass:        'Table font size. font-small = 0.85rem · font-large = 0.93rem. Set per table by design, never auto-changed.',
    stickyCols:       'How many left columns are pinned during horizontal scroll. 0 = none · 1 = first col only · 2 = first two cols.',
    medalRows:        'Apply gold / silver / bronze background tints to rows according to medalCounts.',
    medalCounts:      'Number of rows that receive each medal tint (gold / silver / bronze). Only relevant when medalRows is true.',
    showTopN:         'Initially show only the top N rows. A "Show all" button reveals the rest. null = always show all.',
    mfWidth:          'CSS width on the scroll wrapper. null = auto (table sizes to content). Override for centred fixed-width tables.',
    mfMb:             'CSS margin-bottom on the scroll wrapper. Overrides the default var(--space-lg).',
    mfBg:             'CSS background on the scroll wrapper. Use var(--color-surface) when the table needs an opaque card background.',
    flagSize:         'CSS height for flag images inside the table. null = default (16px).',
    getRowClass:      'Function (row, index) → CSS class string. Adds a per-row class for special styling (e.g. unplayed matches). null = no extra class.',
    summaryRow:       'Append an Averages row (tr.avg-row) at the bottom, sticky to the bottom of the scroll area.',
};

// ─────────────────────────────────────────────
// Preset registry — static config only.
// data / cols / summary are filled by loadAllPresetData().
// ─────────────────────────────────────────────

export const PRESETS = {
    A1: {
        label: 'A1 — Completed Leagues',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   10,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
            flagSize:   '1em',
        },
        argDocs: {
            stickyCols: 'League name column stays visible when scrolling right through Season / Winner / etc.',
            showTopN:   'Top 10 leagues shown initially — covers most recent activity. "Show all" reveals the full history.',
        },
    },

    A2: {
        label: 'A2 — Annual Leaderboard',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 2,
            medalRows:  true,
            showTopN:   5,
            mfWidth:    null,
            mfMb:       'var(--space-xl)',
            mfBg:       null,
            flagSize:   '1em',
        },
        argDocs: {
            stickyCols:  'Both Rank (#) and Player are pinned — you always know who you\'re looking at while scrolling through GP / W / L / Win% / medals / PR.',
            medalRows:   'The all-time top 3 players get a subtle gold / silver / bronze background — a visual trophy shelf.',
            medalCounts: 'Fixed at 1 / 1 / 1 — the leaderboard always awards exactly one gold, one silver, one bronze.',
            showTopN:    'Top 5 shown by default, consistent with A1.',
            mfMb:        'Extra bottom gap (space-xl instead of space-lg) — the leaderboard sits above a visible section break.',
        },
    },

    B1: {
        label: 'B1 — Prizes & Medals',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 0,
            medalRows:  true,
            showTopN:   null,
            mfWidth:    '60%',
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols:  '0 — tiny static table (medal / Tier / Places / Prize). No need to pin anything.',
            medalRows:   'Each tier row gets its medal tint — gold/silver/bronze background.',
            medalCounts: '1 / 1 / 1 — one row per tier (any tier with count 0 is omitted from the data).',
            mfWidth:     '60% of the max display width (max-width: 1100px). Narrower than full so the prize summary sits as a centred card.',
            showTopN:    'null — prize tiers are always shown in full.',
        },
    },

    B2: {
        label: 'B2 — Historical view',
        args: {
            data: [], cols: [],
            fontClass:  'font-large',
            stickyCols: 2,
            medalRows:  true,
            showTopN:   null,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            fontClass:  'font-large — historical view is a focal dashboard element with fewer rows than the full league table.',
            stickyCols: 'Rank (#) and Player pinned — same as A2/D.',
            medalRows:  'Only the medal-eligible rows are shown. Gold/silver/bronze counts come from league_params.json.',
            medalCounts:'Read from league_params.json — defines which rows render in this filtered view.',
            showTopN:   'null — already pre-filtered to medal-eligible rows; no further trimming.',
        },
    },

    B3: {
        label: 'B3 — Championship Predictor',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 2,
            medalRows:  false,
            showTopN:   5,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: 'Rank (#) and Player pinned — keeps each row anchored while scrolling through GP/W/L/PR/Ch%.',
            showTopN:   'Top 5 contenders shown by default; "Show all" reveals the full field. Matches the live predictor UX.',
            medalRows:  'false — predictor rows are not the league podium; their ordering is by championship probability, not final standing.',
        },
    },

    B4: {
        label: 'B4 — What If Simulator',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 2,
            medalRows:  false,
            showTopN:   5,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: 'Same as B3 — rank and name pinned.',
            showTopN:   'Top 5 shown by default. Snapshot uses a T3% distribution (probability of finishing in top 3 under the simulated scenario).',
            medalRows:  'false — simulated standings, not the canonical podium.',
        },
    },

    B5: {
        label: 'B5 — Rounds',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 2,
            medalRows:  false,
            showTopN:   null,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols:  'Both Player A and Player B pinned — keeps the matchup visible while scrolling through PR/Luck/Date.',
            medalRows:   'false — rounds are not ranked.',
            getRowClass: 'Marks unplayed matches with the "unplayed" class → muted italic styling.',
            showTopN:    'null — show all matches in the round.',
        },
    },

    B6a: {
        label: 'B6a — All Remaining',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   null,
            mfWidth:    '80%',
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols:  'Round pinned — easy to scan multi-round backlog.',
            mfWidth:     '80% of the max display width — narrower than full so the list reads as a focused card.',
            getRowClass: 'All rows are unplayed by definition — all rows tagged "unplayed".',
        },
    },

    B6b: {
        label: 'B6b — Remaining Report',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   null,
            mfWidth:    '80%',
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: 'Player column pinned (one of only two columns).',
            mfWidth:    '80% of the max display width — narrow, focused on the two columns.',
        },
    },

    B6c: {
        label: 'B6c — Remaining Per Player',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 0,
            medalRows:  false,
            showTopN:   null,
            mfWidth:    '80%',
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: '0 — single-column table; nothing to pin.',
            mfWidth:    '80% of the max display width — single Unplayed Opponent column, kept narrow.',
        },
    },

    C1: {
        label: 'C1 — Leagues',
        args: {
            data: [], cols: [],
            fontClass:  'font-large',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   null,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            fontClass:  'font-large — high-level summary table on the player\'s general page.',
            stickyCols: 'League name pinned — anchors each row while scrolling through stats.',
        },
    },

    C2: {
        label: 'C2 — Match History',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   10,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: 'League column pinned — keeps context while scrolling through match details.',
            showTopN:   'Top 10 most recent matches by default; "Show all" reveals the full cross-league history.',
        },
    },

    C3: {
        label: 'C3 — Matchup (H2H)',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   10,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: 'League pinned — the league title is the anchor while scrolling through date / score / PR / luck.',
            showTopN:   'Top 10 most recent H2H matches by default; "Show all" reveals the full series.',
        },
    },

    D: {
        label: 'D — League Table',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 2,
            medalRows:  true,
            showTopN:   null,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols:  'Same as A2 — rank and name both pinned. League tables often have many stat columns (Win%, PR, Level, Luck).',
            medalRows:   'The league\'s podium is highlighted. Counts come from league_params.json (GoldCount / SilverCount / BronzeCount).',
            medalCounts: 'Read from league_params.json — varies per league. The badge format and row tint both use these counts.',
            summaryRow:  'An Averages row is always visible at the bottom of the scroll area — acts as a reference line while you compare players.',
            showTopN:    'null — a league table always shows every player. There is no "top N" concept here.',
        },
    },

    E: {
        label: 'E — Player Match History',
        args: {
            data: [], cols: [],
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   null,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols:  'Only Opponent is pinned — there is no rank column in a match history. One sticky col is enough to track who you\'re looking at.',
            medalRows:   'false — match history rows are not ranked; no podium logic applies.',
            getRowClass: 'Marks unplayed matches with the "unplayed" class → muted italic row styling.',
            summaryRow:  'Averages row at bottom shows the player\'s overall PR, luck, and record for this league.',
            showTopN:    'null — show the full match history always. A player wants to see every game.',
        },
    },
};

// ─────────────────────────────────────────────
// UI wiring
// ─────────────────────────────────────────────

const mountPoint = document.getElementById('mf-mount');
const argsPanel  = document.getElementById('args-panel');

function renderPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    // mountMFTable clears mountPoint and rebuilds everything internally
    mountMFTable(mountPoint, preset.args);
    renderArgsPanel(preset);
}

function renderArgsPanel(preset) {
    const { args, argDocs } = preset;

    function argRow(key, value, keyLabel) {
        const docBase  = ARG_DOCS_BASE[key] || '';
        const docExtra = argDocs[key] || '';
        const display  = value === null  ? '<span class="arg-null">null</span>'
                       : value === true  ? '<span class="arg-true">true</span>'
                       : value === false ? '<span class="arg-false">false</span>'
                       : `<span class="arg-value">${value}</span>`;
        return `
        <div class="arg-row">
            <div class="arg-head">
                <code class="arg-name">${keyLabel ?? key}</code>
                ${display}
            </div>
            ${docBase  ? `<p class="arg-base-doc">${docBase}</p>`    : ''}
            ${docExtra ? `<p class="arg-extra-doc">↳ ${docExtra}</p>` : ''}
        </div>`;
    }

    function fnRow(key, fn) {
        const docBase  = ARG_DOCS_BASE[key] || '';
        const docExtra = argDocs[key] || '';
        const display  = fn != null ? '<span class="arg-true">function</span>' : '<span class="arg-null">null</span>';
        return `
        <div class="arg-row">
            <div class="arg-head">
                <code class="arg-name">${key}</code>
                ${display}
            </div>
            ${docBase  ? `<p class="arg-base-doc">${docBase}</p>`    : ''}
            ${docExtra ? `<p class="arg-extra-doc">↳ ${docExtra}</p>` : ''}
        </div>`;
    }

    const rows = [];

    // ── Simple values (top) ────────────────────
    const simpleKeys = [
        ['fontClass',  'fontClass'],
        ['stickyCols', 'stickyCols'],
        ['medalRows',  'medalRows'],
        ['showTopN',   'showTopN'],
        ['mfWidth',    '--mf-width'],
        ['mfMb',       '--mf-mb'],
        ['mfBg',       '--mf-bg'],
        ['flagSize',   'flagSize'],
    ];

    for (const [key, label] of simpleKeys) {
        if (key === 'flagSize' && !('flagSize' in args)) continue;
        rows.push(argRow(key, args[key] ?? null, label));

        // medalCounts shown immediately after medalRows (only when medalRows is active)
        if (key === 'medalRows' && args.medalRows && args.medalCounts) {
            const mc  = args.medalCounts;
            rows.push(argRow('medalCounts', `${mc.gold} / ${mc.silver} / ${mc.bronze}`, 'medalCounts'));
        }
    }

    // ── Functions (bottom) ─────────────────────
    rows.push(fnRow('getRowClass',     args.getRowClass));
    rows.push(fnRow('buildSummaryRow', args.buildSummaryRow));

    argsPanel.innerHTML = `<h2 class="args-title">Arguments</h2>${rows.join('')}`;
}

// Tab switching
document.querySelectorAll('.preset-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderPreset(btn.dataset.preset);
    });
});

// ─────────────────────────────────────────────
// Theme picker (bottom-right, identical to all real pages)
initThemePicker();

// Boot — show loading state, then load real data
// ─────────────────────────────────────────────

argsPanel.innerHTML  = '<p style="color:var(--color-text-muted);font-size:0.85rem;padding:var(--space-sm)">Loading…</p>';
mountPoint.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;padding:var(--space-xl)">Loading league data…</p>';

loadAllPresetData().then(loaded => {
    const allKeys = ['A1', 'A2', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6a', 'B6b', 'B6c', 'C1', 'C2', 'C3', 'D', 'E'];
    for (const key of allKeys) {
        if (!loaded[key]) continue;
        const { data, cols, buildSummaryRow, getRowClass, medalCounts } = loaded[key];
        Object.assign(PRESETS[key].args, { data, cols, buildSummaryRow, getRowClass,
            ...(medalCounts ? { medalCounts } : {}) });
    }

    // Update tab labels with actual league / player names
    const setTab = (key, text) => {
        PRESETS[key].label = text;
        const btn = document.querySelector(`[data-preset="${key}"]`);
        if (btn) btn.textContent = text;
    };
    if (loaded.B1?.leagueTitle)  setTab('B1',  `B1 — Prizes (${loaded.B1.leagueTitle})`);
    if (loaded.B2?.leagueTitle)  setTab('B2',  `B2 — Historical (${loaded.B2.leagueTitle})`);
    if (loaded.B3?.leagueTitle)  setTab('B3',  `B3 — Predictor (${loaded.B3.leagueTitle})`);
    if (loaded.B4?.leagueTitle)  setTab('B4',  `B4 — What If (${loaded.B4.leagueTitle})`);
    if (loaded.B5?.leagueTitle)  setTab('B5',  `B5 — Round 1 (${loaded.B5.leagueTitle})`);
    if (loaded.B6a?.leagueTitle) setTab('B6a', `B6a — Remaining (${loaded.B6a.leagueTitle})`);
    if (loaded.B6b?.leagueTitle) setTab('B6b', `B6b — Per Player (${loaded.B6b.leagueTitle})`);
    if (loaded.B6c?.playerName)  setTab('B6c', `B6c — ${loaded.B6c.playerName}`);
    if (loaded.C1?.playerName)   setTab('C1',  `C1 — ${loaded.C1.playerName}`);
    if (loaded.C2?.playerName)   setTab('C2',  `C2 — ${loaded.C2.playerName}`);
    if (loaded.C3?.playerName && loaded.C3?.opponent) setTab('C3', `C3 — ${loaded.C3.playerName} vs ${loaded.C3.opponent}`);
    if (loaded.D.leagueTitle)    setTab('D',   `D — ${loaded.D.leagueTitle}`);
    if (loaded.E.playerName)     setTab('E',   `E — ${loaded.E.playerName}`);

    renderPreset('A1');
}).catch(err => {
    console.error('Lab load error:', err);
    mountPoint.innerHTML = `<p style="color:var(--color-loss,#b91c1c);padding:var(--space-xl)">Failed to load data: ${err.message}</p>`;
    argsPanel.innerHTML = '';
});
