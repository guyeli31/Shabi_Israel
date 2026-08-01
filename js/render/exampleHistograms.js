/**
 * exampleHistograms.js — small, static, theme-aware SVG figures used inside the
 * "?" popups to make an abstract histogram concrete: they show exactly which bin
 * a worked example lands in.
 *
 * Same conventions as luckContribCurve.js: pure string builders (no DOM), colours
 * via CSS custom properties with hard hex fallbacks, everything else in
 * currentColor, and the <svg> forced to direction:ltr so the plot geometry never
 * flips under an RTL page. The prose that carries signed numbers lives in an HTML
 * <figcaption> (not inside the SVG), so the browser's bidi algorithm — not us —
 * orders "+2.5" / "−3" correctly in Hebrew.
 */

const WIN = 'var(--color-win, #2e9e5b)';
const LOSS = 'var(--color-loss, #d64545)';

/** One bar. x/y/w/h already in plot coordinates. */
function bar(x, y, w, h, fill, op) {
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}" fill-opacity="${op}"/>`;
}

/**
 * Player page · "Total PR ↔ Result": where the two worked-example matches land.
 * A neutral grey histogram of one player's matches, with the won match's bin
 * ([2, 3), gap +2.5) tinted green and the lost match's bin ([3, 4), gap +3.0)
 * tinted red — the same two matches the example paragraph describes in words.
 */
export function prGapExampleHistogramSvg(lang) {
    const he = lang === 'he';
    const W = 340, H = 176, L = 34, R = 330, T = 16, B = 140;
    const GMIN = -4, GMAX = 4, nbins = GMAX - GMIN;   // 8 bins, width 1
    const bw = (R - L) / nbins;
    const xForG = g => L + (g - GMIN) * bw;            // left edge of gap value g
    const counts = [1, 2, 4, 7, 9, 8, 6, 3];          // schematic per-bin counts
    const WIN_BIN = 6, LOSS_BIN = 7;                  // [2,3) and [3,4)
    const YMAX = 10;
    const yFor = c => B - (c / YMAX) * (B - T);

    let bars = '', labels = '';
    for (let i = 0; i < nbins; i++) {
        const x = xForG(GMIN + i) + 3, w = bw - 6, y = yFor(counts[i]), h = B - y;
        const hl = i === WIN_BIN || i === LOSS_BIN;
        const fill = i === WIN_BIN ? WIN : i === LOSS_BIN ? LOSS : 'currentColor';
        bars += bar(x, y, w, h, fill, hl ? 0.92 : 0.15);
        if (hl) {
            const cx = x + w / 2, lbl = i === WIN_BIN ? '[2, 3)' : '[3, 4)';
            labels += `<text x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${fill}">${lbl}</text>`;
        }
    }

    let ticks = '';
    for (let g = GMIN; g <= GMAX; g++) {
        const x = xForG(g);
        ticks += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${B}" y2="${B + 4}" stroke="currentColor" stroke-opacity="0.45"/>`
              + `<text x="${x.toFixed(1)}" y="${(B + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.7">${g > 0 ? '+' + g : g}</text>`;
    }
    const x0 = xForG(0).toFixed(1);
    const zero = `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.3" stroke-dasharray="3 3"/>`;
    // Axis labels are ALWAYS English, matching the shared luck-metric figures.
    const xlab = 'PR gap';

    const cap = he
        ? `העמודות האפורות הן כלל משחקי השחקן. התא הירוק <span dir="ltr">[2,&nbsp;3)</span> הוא המשחק שנוצח (הפרש <span dir="ltr">+2.5</span>), והתא האדום <span dir="ltr">[3,&nbsp;4)</span> הוא המשחק שהופסד (הפרש <span dir="ltr">+3.0</span>).`
        : `The grey bars are all of the player's matches. The green bin [2,&nbsp;3) holds the won match (gap +2.5) and the red bin [3,&nbsp;4) the lost match (gap +3.0).`;

    return `
        <figure class="pm-figure" style="margin:14px 0">
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${he ? 'לאן נכנס כל משחק לדוגמה' : 'where each example match lands'}" xmlns="http://www.w3.org/2000/svg" style="max-width:360px;width:100%;height:auto;color:inherit;direction:ltr">
                ${zero}
                ${bars}
                ${labels}
                <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
                ${ticks}
                <text x="${((L + R) / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85">${xlab}</text>
            </svg>
            <figcaption class="pm-caption">${cap}</figcaption>
        </figure>`;
}

/**
 * Dashboard · "League PR ↔ Result": what the advantage histogram looks like as a
 * whole. A right-skewed distribution — most of the mass sits to the RIGHT of 0
 * (the winner also had the better PR: the favourite won, an expected result),
 * with a thinner left tail of upsets. The two halves are washed faint green /
 * red behind the neutral bars purely to label the axis; the live chart does not
 * tint its bars.
 */
export function advantageDistributionExampleHistogramSvg(lang) {
    const he = lang === 'he';
    const W = 340, H = 178, L = 30, R = 332, T = 24, B = 142;
    const AMIN = -6, AMAX = 6, nbins = AMAX - AMIN;   // 12 bins, width 1
    const bw = (R - L) / nbins;
    const xForA = a => L + (a - AMIN) * bw;
    //            -6 -5 -4 -3  -2  -1   0   1   2   3   4  5
    const counts = [2, 4, 8, 14, 22, 32, 42, 46, 40, 28, 15, 6];
    const YMAX = 52;
    const yFor = c => B - (c / YMAX) * (B - T);
    const x0 = xForA(0);

    // Faint half washes that label the axis (expected vs upset).
    const washes = `<rect x="${x0.toFixed(1)}" y="${T}" width="${(R - x0).toFixed(1)}" height="${B - T}" fill="${WIN}" fill-opacity="0.06"/>`
        + `<rect x="${L}" y="${T}" width="${(x0 - L).toFixed(1)}" height="${B - T}" fill="${LOSS}" fill-opacity="0.06"/>`;

    let bars = '';
    for (let i = 0; i < nbins; i++) {
        const x = xForA(AMIN + i) + 2, w = bw - 4, y = yFor(counts[i]), h = B - y;
        bars += bar(x, y, w, h, 'currentColor', 0.3);
    }

    let ticks = '';
    for (let a = AMIN; a <= AMAX; a += 2) {
        const x = xForA(a);
        ticks += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${B}" y2="${B + 4}" stroke="currentColor" stroke-opacity="0.45"/>`
              + `<text x="${x.toFixed(1)}" y="${(B + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.7">${a > 0 ? '+' + a : a}</text>`;
    }
    const zero = `<line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.4" stroke-dasharray="3 3"/>`;
    // In-plot labels are ALWAYS English, matching the shared luck-metric figures.
    const rightLbl = 'expected results';
    const leftLbl = 'upsets';
    const sideLabels = `<text x="${(x0 + (R - x0) / 2).toFixed(1)}" y="${T + 4}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${WIN}">${rightLbl}</text>`
        + `<text x="${(L + (x0 - L) / 2).toFixed(1)}" y="${T + 4}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${LOSS}">${leftLbl}</text>`;
    const xlab = 'advantage (PR points)';

    const cap = he
        ? `זו התפלגות היתרון של כל משחקי הליגה. רוב המסה נמצאת <b>מימין ל-0</b> — כלומר המנצח בדרך כלל שיחק טוב יותר (המועדף ניצח); הזנב השמאלי הדק הוא ההפתעות. שיא הגבעה יושב ימינה מ-0, מה שמאשר שהשחקן הטוב יותר אכן מנצח לרוב.`
        : `This is the advantage distribution over every match in the league. Most of the mass sits <b>right of 0</b> — the winner usually also played better (the favourite won); the thin left tail is the upsets. The peak sits right of 0, confirming the better player does win most of the time.`;

    return `
        <figure class="pm-figure" style="margin:14px 0">
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${he ? 'התפלגות היתרון בליגה' : 'the league advantage distribution'}" xmlns="http://www.w3.org/2000/svg" style="max-width:360px;width:100%;height:auto;color:inherit;direction:ltr">
                ${washes}
                ${zero}
                ${bars}
                ${sideLabels}
                <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
                ${ticks}
                <text x="${((L + R) / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85">${xlab}</text>
            </svg>
            <figcaption class="pm-caption">${cap}</figcaption>
        </figure>`;
}

/**
 * Dashboard · "Table Validation": how the favourite-win-rate is read off two
 * symmetric bins. The advantage histogram is right-skewed (favourites win more
 * than they lose); the +3 bin (favourite won) and its mirror −3 bin (an upset)
 * are tinted, and their split IS the empirical win rate for a 3-point gap.
 */
export function tableValidationExampleHistogramSvg(lang) {
    const he = lang === 'he';
    const W = 340, H = 178, L = 30, R = 332, T = 16, B = 142;
    const AMIN = -6, AMAX = 6, nbins = AMAX - AMIN;   // 12 bins, width 1
    const bw = (R - L) / nbins;
    const xForA = a => L + (a - AMIN) * bw;
    //            -6 -5 -4 -3 -2 -1  0  1   2   3   4   5
    const counts = [2, 5, 9, 18, 26, 34, 40, 46, 48, 42, 30, 16];
    const POS_BIN = 9, NEG_BIN = 3;                   // advantage +3 and −3
    const posN = counts[POS_BIN], negN = counts[NEG_BIN];
    const YMAX = 52;
    const yFor = c => B - (c / YMAX) * (B - T);

    let bars = '', labels = '';
    for (let i = 0; i < nbins; i++) {
        const x = xForA(AMIN + i) + 2, w = bw - 4, y = yFor(counts[i]), h = B - y;
        const hl = i === POS_BIN || i === NEG_BIN;
        const fill = i === POS_BIN ? WIN : i === NEG_BIN ? LOSS : 'currentColor';
        bars += bar(x, y, w, h, fill, hl ? 0.92 : 0.14);
        if (hl) {
            const cx = x + w / 2;
            labels += `<text x="${cx.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${fill}">${counts[i]}</text>`;
        }
    }

    let ticks = '';
    for (let a = AMIN; a <= AMAX; a += 2) {
        const x = xForA(a);
        ticks += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${B}" y2="${B + 4}" stroke="currentColor" stroke-opacity="0.45"/>`
              + `<text x="${x.toFixed(1)}" y="${(B + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.7">${a > 0 ? '+' + a : a}</text>`;
    }
    const x0 = xForA(0).toFixed(1);
    const zero = `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="3 3"/>`;
    // Axis labels are ALWAYS English, matching the shared luck-metric figures.
    const xlab = 'advantage (PR points)';

    const total = posN + negN;
    const winRate = Math.round((posN / total) * 100);
    const cap = he
        ? `שני התאים המסומנים הם אותו פער בגודל 3, בשני הכיוונים: <b>${posN}</b> משחקים בפער <span dir="ltr">+3</span> (המועדף ניצח) מול <b>${negN}</b> בפער <span dir="ltr">&minus;3</span> (הפתעה). שיעור ניצחון המועדף בפועל = <span dir="ltr">${posN} / ${total} = ${winRate}%</span>, לעומת כ-<span dir="ltr">66%</span> שהטבלה חוזה לפער כזה &mdash; קרוב, כלומר הנתונים תואמים את הטבלה.`
        : `The two tinted bins are the same 3-point gap in both directions: <b>${posN}</b> matches at <span dir="ltr">+3</span> (favourite won) vs <b>${negN}</b> at <span dir="ltr">&minus;3</span> (an upset). The favourite's real win rate = <span dir="ltr">${posN} / ${total} = ${winRate}%</span>, against the ~<span dir="ltr">66%</span> the table predicts for that gap &mdash; close, so the data matches the table.`;

    return `
        <figure class="pm-figure" style="margin:14px 0">
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${he ? 'שני תאים סימטריים: שיעור ניצחון המועדף' : 'two symmetric bins: the favourite win rate'}" xmlns="http://www.w3.org/2000/svg" style="max-width:360px;width:100%;height:auto;color:inherit;direction:ltr">
                ${zero}
                ${bars}
                ${labels}
                <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
                ${ticks}
                <text x="${((L + R) / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85">${xlab}</text>
            </svg>
            <figcaption class="pm-caption">${cap}</figcaption>
        </figure>`;
}
