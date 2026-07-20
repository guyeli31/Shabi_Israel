/**
 * wc26.js — Renders the WC26 (מונדיאל 2026) betting dashboard.
 *
 * Standalone page (like Analytics): no INDEX/nav dependency. Reuses the shared
 * design system (variables/themes/theme-picker/MF tables) via ../ relative paths
 * from wc26.html. Three sections, all RTL Hebrew:
 *   1. Overall ranking      — every column sortable, default total DESC.
 *   2. Result accuracy      — every column sortable, default בול DESC → כיוון DESC.
 *   3. Pre-match bets        — NOT sortable, fixed total-DESC order, empty = "–".
 *
 * Medals (gold/silver/bronze) mark each table's true top-3 by its canonical
 * ranking and stay pinned to those players even when the user re-sorts, so gold
 * always reads as the actual leader rather than "whatever is on top right now".
 */

import { MAIN, ACCURACY, PREMATCH, PREMATCH_CATEGORIES } from './wc26-data.js';

const EMPTY = '–'; // en dash for un-scored pre-match cells (never "0")

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmt2 = (v) => Number(v).toFixed(2);

// Deterministic tri-state compare; Hebrew names via localeCompare('he').
function cmpNum(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function cmpName(a, b) { return a.localeCompare(b, 'he'); }

/**
 * Build the name → medal-class map for a table from its canonical ordering.
 * `rankedNames` is already in best-first order; the first three get medals.
 */
function medalMap(rankedNames) {
  const m = new Map();
  const classes = ['rank-gold', 'rank-silver', 'rank-bronze'];
  rankedNames.slice(0, 3).forEach((name, i) => m.set(name, classes[i]));
  return m;
}

const MEDAL_LABEL = { 'rank-gold': '🥇', 'rank-silver': '🥈', 'rank-bronze': '🥉' };

/**
 * A sortable MF table. `columns` each own their label + value getter + cell
 * renderer, so header and body can never drift. Clicking a header sorts by that
 * column (toggling asc/desc); the seeded `defaultSort` decides the initial view
 * and supplies the tiebreak used whenever two rows are equal on the sort key.
 */
function sortableTable(host, { rows, columns, defaultSort, medals }) {
  const st = { key: defaultSort.key, dir: defaultSort.dir };

  // Fixed position column: always 1 (top) → 15 (bottom) in the CURRENT display
  // order, for every sort. Not sortable; sticky at the RTL start (right) edge.
  const posCol = {
    label: '#', sortable: false,
    headClass: 'wc26-pos-col wc26-sticky-edge',
    cellClass: 'wc26-pos-cell wc26-sticky-edge',
    render: (r, i) => String(i + 1),
  };
  const allCols = [posCol, ...columns];

  function comparator(a, b) {
    const col = columns.find((c) => c.key === st.key);
    let d = col.cmp(a, b) * (st.dir === 'asc' ? 1 : -1);
    if (d === 0 && defaultSort.tiebreak) {
      const tb = columns.find((c) => c.key === defaultSort.tiebreak);
      d = tb.cmp(a, b) * -1; // tiebreak is always "higher is better"
    }
    if (d === 0) d = cmpName(a.name, b.name);
    return d;
  }

  function draw() {
    const sorted = [...rows].sort(comparator);

    const thead = allCols.map((c) => {
      if (c.sortable === false) {
        return `<th class="${c.headClass}">${escapeHtml(c.label)}</th>`;
      }
      const active = c.key === st.key;
      const arrow = active ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '';
      const cls = [c.headClass, active ? 'sorted' : ''].filter(Boolean).join(' ');
      return `<th data-sort-key="${c.key}"${cls ? ` class="${cls}"` : ''} title="לחצו למיון">${escapeHtml(c.label)}<span class="wc26-arrow">${arrow}</span></th>`;
    }).join('');

    const tbody = sorted.map((r, i) => {
      const medal = medals.get(r.name) || '';
      const cells = allCols.map((c) => {
        const cls = c.cellClass ? ` class="${c.cellClass}"` : '';
        return `<td${cls}>${c.render(r, i)}</td>`;
      }).join('');
      return `<tr${medal ? ` class="${medal}"` : ''}>${cells}</tr>`;
    }).join('');

    host.innerHTML = `
      <div class="mf-wrap wc26-wrap">
        <table class="wc26-table">
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>`;

    host.querySelectorAll('th[data-sort-key]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (st.key === key) {
          st.dir = st.dir === 'asc' ? 'desc' : 'asc';
        } else {
          st.key = key;
          // Numbers open high→low (rank-like); the name column opens A→Z.
          st.dir = key === 'name' ? 'asc' : 'desc';
        }
        draw();
      });
    });
  }

  draw();
}

// Shared cell renderer: player name, with a medal glyph for the top-3.
function nameCell(r, medals) {
  const medal = medals.get(r.name);
  const badge = medal ? `<span class="wc26-medal">${MEDAL_LABEL[medal]}</span>` : '';
  return `<span class="wc26-name">${badge}${escapeHtml(r.name)}</span>`;
}

/* ── Section 1: overall ranking ──────────────────────────────────── */
function renderMain(host) {
  const medals = medalMap([...MAIN].sort((a, b) => cmpNum(b.total, a.total)).map((r) => r.name));
  const num = (key) => ({
    key, cmp: (a, b) => cmpNum(a[key], b[key]),
    render: (r) => fmt2(r[key]),
    cellClass: 'wc26-num',
  });
  sortableTable(host, {
    rows: MAIN,
    medals,
    defaultSort: { key: 'total', dir: 'desc' },
    columns: [
      { key: 'name', label: 'שחקן', cmp: (a, b) => cmpName(a.name, b.name),
        render: (r) => nameCell(r, medals), headClass: 'wc26-name-col', cellClass: 'wc26-name-cell' },
      { ...num('pre'), label: 'משחק מקדים' },
      { ...num('regular'), label: 'תוצאות רגילות' },
      { ...num('challenge'), label: 'אתגרים' },
      { ...num('total'), label: 'סה״כ', headClass: 'total-col', cellClass: 'wc26-num total-col' },
    ],
  });
}

/* ── Section 2: result-guess accuracy ────────────────────────────── */
function renderAccuracy(host) {
  const canonical = [...ACCURACY].sort((a, b) => cmpNum(b.bull, a.bull) || cmpNum(b.direction, a.direction));
  const medals = medalMap(canonical.map((r) => r.name));
  const num = (key) => ({
    key, cmp: (a, b) => cmpNum(a[key], b[key]),
    render: (r) => String(r[key]),
    cellClass: 'wc26-num',
  });
  sortableTable(host, {
    rows: ACCURACY,
    medals,
    defaultSort: { key: 'bull', dir: 'desc', tiebreak: 'direction' },
    columns: [
      { key: 'name', label: 'שחקן', cmp: (a, b) => cmpName(a.name, b.name),
        render: (r) => nameCell(r, medals), headClass: 'wc26-name-col', cellClass: 'wc26-name-cell' },
      { ...num('bull'), label: 'בול' },
      { ...num('direction'), label: 'כיוון' },
      { ...num('miss'), label: 'טעות' },
    ],
  });
}

/* ── Section 3: pre-match bets (fixed order, not sortable) ────────── */
function renderPrematch(host) {
  const rows = [...PREMATCH].sort((a, b) => cmpNum(b.total, a.total)); // stable total-DESC
  const medals = medalMap(rows.map((r) => r.name));
  const cats = PREMATCH_CATEGORIES;

  const headTop = `
    <th rowspan="2" class="wc26-pos-col">#</th>
    <th rowspan="2" class="wc26-name-col wc26-sticky-edge">שחקן</th>
    ${cats.map((c) => `<th class="wc26-cat" title="${escapeHtml(c.label)}: ${escapeHtml(c.result)}">${escapeHtml(c.label)}</th>`).join('')}
    <th rowspan="2" class="total-col">סה״כ</th>`;
  const headSub = cats.map((c) => `<th class="wc26-result-sub">${escapeHtml(c.result)}</th>`).join('');

  const body = rows.map((r, i) => {
    const medal = medals.get(r.name) || '';
    const cells = cats.map((c) => {
      const v = r.values[c.key];
      return v == null
        ? `<td class="wc26-num wc26-empty">${EMPTY}</td>`
        : `<td class="wc26-num">${v}</td>`;
    }).join('');
    return `<tr${medal ? ` class="${medal}"` : ''}>
        <td class="wc26-pos-cell wc26-sticky-edge">${i + 1}</td>
        <td class="wc26-name-cell wc26-sticky-edge">${nameCell(r, medals)}</td>
        ${cells}
        <td class="wc26-num total-col">${r.total}</td>
      </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="mf-wrap wc26-prematch-wrap wc26-wrap">
      <table class="wc26-table wc26-prematch">
        <thead>
          <tr>${headTop}</tr>
          <tr>${headSub}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  // Pin the name column just inside the (variable-width) # column: measure the
  // rendered # header and expose it as --wc26-pos-w for the name's start offset.
  const table = host.querySelector('.wc26-prematch');
  const measurePos = () => {
    const th = table.querySelector('thead th.wc26-pos-col');
    if (th) table.style.setProperty('--wc26-pos-w', `${th.getBoundingClientRect().width}px`);
  };
  measurePos();
  window.addEventListener('resize', measurePos);
}

export function renderWc26Page() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <section class="app-section app-section--card">
      <h2 class="app-section-h2">דירוג כללי</h2>
      <p class="wc26-section-note">סך הנקודות משלושת סוגי ההימור. כל העמודות ניתנות למיון — לחצו על כותרת.</p>
      <div id="wc26-main"></div>
    </section>

    <section class="app-section app-section--card">
      <h2 class="app-section-h2">דיוק תוצאות</h2>
      <p class="wc26-section-note">בול = תוצאה מדויקת · כיוון = מנצח נכון · טעות = ניחוש שגוי. מיון ברירת מחדל: בול, ואז כיוון.</p>
      <div id="wc26-accuracy"></div>
    </section>

    <section class="app-section app-section--card">
      <h2 class="app-section-h2">משחק מקדים</h2>
      <p class="wc26-section-note">ההימורים שמולאו פעם אחת לפני הטורניר. תת־הכותרת מציגה את התוצאה בפועל. תא ריק = לא נוקדה נקודה. סדר קבוע לפי סה״כ.</p>
      <div id="wc26-prematch"></div>
    </section>`;

  renderMain(document.getElementById('wc26-main'));
  renderAccuracy(document.getElementById('wc26-accuracy'));
  renderPrematch(document.getElementById('wc26-prematch'));

  // Toggle the sticky-boundary drop-shadow on each table once it scrolls
  // horizontally (mirrors the MF attachStickyShadow behaviour).
  document.querySelectorAll('#content .wc26-wrap').forEach((wrap) => {
    const sync = () => wrap.classList.toggle('is-scrolled-x', Math.abs(wrap.scrollLeft) > 0);
    wrap.addEventListener('scroll', sync, { passive: true });
    sync();
  });
}
