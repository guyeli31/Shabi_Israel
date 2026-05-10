/**
 * lab.js — Preset definitions and UI wiring for the MF Table Lab.
 *
 * Data is loaded live from the real project modules via lab-loader.js.
 * Each PRESET holds the static config (fontClass, stickyCols, argDocs …)
 * and receives data/cols/summary after the async load completes.
 */

import { mountMFTable } from './mount-mf-table.js';
import { loadAllPresetData } from './lab-loader.js';
import { initThemePicker } from '../js/render/themePicker.js';

// ─────────────────────────────────────────────
// Argument documentation (shared vocabulary)
// ─────────────────────────────────────────────

const ARG_DOCS_BASE = {
    fontClass:        'Table font size. font-small = 0.85rem · font-large = 0.93rem. Set per table by design, never auto-changed.',
    stickyCols:       'How many left columns are pinned during horizontal scroll. 0 = none · 1 = first col only · 2 = first two cols.',
    medalRows:        'Apply gold / silver / bronze background tints to the top 1 / 2 / 3 rows.',
    summaryRow:       'Append an Averages row (tr.avg-row) at the bottom, sticky to the bottom of the scroll area.',
    showTopN:         'Initially show only the top N rows. A "Show all" button reveals the rest. null = always show all.',
    mfWidth:          'CSS width on the scroll wrapper. null = auto (table sizes to content). Override for centred fixed-width tables.',
    mfMb:             'CSS margin-bottom on the scroll wrapper. Overrides the default var(--space-lg).',
    mfBg:             'CSS background on the scroll wrapper. Use var(--color-surface) when the table needs an opaque card background.',
};

// ─────────────────────────────────────────────
// Preset registry — static config only.
// data / cols / summary are filled by loadAllPresetData().
// ─────────────────────────────────────────────

export const PRESETS = {
    A1: {
        label: 'A1 — Completed Leagues',
        args: {
            data: [], cols: [], summary: null,
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   5,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
            flagSize:   '1em',
        },
        argDocs: {
            stickyCols: 'League name column stays visible when scrolling right through Season / Winner / etc.',
            showTopN:   'Top 5 leagues shown initially — covers most recent activity. "Show all" reveals the full history.',
        },
    },

    A2: {
        label: 'A2 — Annual Leaderboard',
        args: {
            data: [], cols: [], summary: null,
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
            stickyCols: 'Both Rank (#) and Player are pinned — you always know who you\'re looking at while scrolling through GP / W / L / Win% / medals / PR.',
            medalRows:  'The all-time top 3 players get a subtle gold / silver / bronze background — a visual trophy shelf.',
            showTopN:   'Top 5 shown by default, consistent with A1.',
            mfMb:       'Extra bottom gap (space-xl instead of space-lg) — the leaderboard sits above a visible section break.',
        },
    },

    D: {
        label: 'D — League Table',
        args: {
            data: [], cols: [], summary: null,
            fontClass:  'font-small',
            stickyCols: 2,
            medalRows:  true,
            showTopN:   null,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: 'Same as A2 — rank and name both pinned. League tables often have many stat columns (Win%, PR, Level, Luck).',
            medalRows:  'The league\'s podium is highlighted. Gold / silver / bronze counts come from league_params.json in the real app.',
            summaryRow: 'An Averages row is always visible at the bottom of the scroll area — acts as a reference line while you compare players.',
            showTopN:   'null — a league table always shows every player. There is no "top N" concept here.',
        },
    },

    E: {
        label: 'E — Player Match History',
        args: {
            data: [], cols: [], summary: null,
            fontClass:  'font-small',
            stickyCols: 1,
            medalRows:  false,
            showTopN:   null,
            mfWidth:    null,
            mfMb:       null,
            mfBg:       null,
        },
        argDocs: {
            stickyCols: 'Only Opponent is pinned — there is no rank column in a match history. One sticky col is enough to track who you\'re looking at.',
            medalRows:  'false — match history rows are not ranked; no podium logic applies.',
            summaryRow: 'Averages row at bottom shows the player\'s overall PR, luck, and record for this league.',
            showTopN:   'null — show the full match history always. A player wants to see every game.',
        },
    },
};

// ─────────────────────────────────────────────
// UI wiring
// ─────────────────────────────────────────────

const wrapper   = document.getElementById('mf-table-wrap');
const argsPanel = document.getElementById('args-panel');

function renderPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;

    // Clear stale "Show all" button from previous preset
    const staleBtn = wrapper.nextSibling;
    if (staleBtn?.classList?.contains('show-more-btn')) staleBtn.remove();

    // Reset sticky shadow state
    delete wrapper.dataset.stickyShadowAttached;

    mountMFTable(wrapper, preset.args);
    renderArgsPanel(preset);
}

function renderArgsPanel(preset) {
    const { args, argDocs } = preset;

    const configKeys = ['fontClass', 'stickyCols', 'medalRows', 'showTopN', 'mfWidth', 'mfMb', 'mfBg'];
    const internalKeys = new Set(['data', 'cols', 'summary', 'flagSize', ...configKeys]);

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
            ${docBase ? `<p class="arg-base-doc">${docBase}</p>` : ''}
            ${docExtra ? `<p class="arg-extra-doc">↳ ${docExtra}</p>` : ''}
        </div>`;
    }

    const rows = configKeys.map(key => {
        const keyLabel = key === 'mfWidth' ? '--mf-width'
                       : key === 'mfMb'    ? '--mf-mb'
                       : key === 'mfBg'    ? '--mf-bg'
                       : key;
        return argRow(key, args[key], keyLabel);
    });

    // summaryRow derived from summary presence
    const hasSummary   = args.summary != null;
    const summaryExtra = argDocs['summaryRow'] || '';
    rows.splice(3, 0, `
        <div class="arg-row">
            <div class="arg-head">
                <code class="arg-name">summary</code>
                ${hasSummary ? '<span class="arg-true">object</span>' : '<span class="arg-null">null</span>'}
            </div>
            <p class="arg-base-doc">Data object for the sticky Averages row (tr.avg-row). null = no summary row.</p>
            ${summaryExtra ? `<p class="arg-extra-doc">↳ ${summaryExtra}</p>` : ''}
        </div>`);

    // Preset-specific extra args (beyond the standard block)
    for (const key of Object.keys(args)) {
        if (!internalKeys.has(key)) rows.push(argRow(key, args[key]));
    }

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

argsPanel.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;padding:var(--space-sm)">Loading…</p>';
wrapper.innerHTML   = '<p style="color:var(--color-text-muted);font-size:0.85rem;padding:var(--space-xl)">Loading league data…</p>';

loadAllPresetData().then(loaded => {
    // Merge real data/cols/summary into each preset's args
    for (const key of ['A1', 'A2', 'D', 'E']) {
        const { data, cols, summary } = loaded[key];
        Object.assign(PRESETS[key].args, { data, cols, summary });
    }

    // Update D / E tab labels with the actual league / player
    if (loaded.D.leagueTitle) {
        PRESETS.D.label = `D — ${loaded.D.leagueTitle}`;
        document.querySelector('[data-preset="D"]').textContent = `D — ${loaded.D.leagueTitle}`;
    }
    if (loaded.E.playerName && loaded.E.leagueTitle) {
        PRESETS.E.label = `E — ${loaded.E.playerName} (${loaded.E.leagueTitle})`;
        document.querySelector('[data-preset="E"]').textContent = `E — ${loaded.E.playerName}`;
    }

    renderPreset('A1');
}).catch(err => {
    console.error('Lab load error:', err);
    wrapper.innerHTML = `<p style="color:var(--color-loss,#b91c1c);padding:var(--space-xl)">Failed to load data: ${err.message}</p>`;
    argsPanel.innerHTML = '';
});
