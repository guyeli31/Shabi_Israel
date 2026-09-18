/**
 * chartStepper.js — the ‹ N / M › bar that walks a chart's pinned point one
 * step at a time.
 *
 * Why it exists at all: a canvas chart maps its whole plot width onto its
 * points, and on a phone that width is ~350px. Measured on a 430px device:
 * the Title Race timeline gives a point ~1.3px, the league PR-gap histograms
 * give a bar 1–2px, the cross-league PR histogram 2–3px, the match-history
 * bars ~2px. Choosing a particular one by finger is not something anyone can
 * do, and nudging one across is worse. The stepper makes the axis navigable
 * by PRESSING rather than by aiming.
 *
 * Why it is shared: six charts mount it. Any chart that can pin a point by
 * index can, by handing over a controller with `getPinned()` / `setPinned()`.
 *
 * The bar is inserted INSIDE the chart host, directly above the detail panel,
 * so it sits under the X axis it scrubs. Placing it after the host drifts it a
 * screen away the moment the panel grows (the Title Race panel is a title line
 * plus one row per plotted player).
 */

/**
 * @param {HTMLElement} chartHost  the element the chart drew itself into
 * @param {object} opts
 *   controller  — { getPinned(): number, setPinned(i): number }, the chart's own
 *                 pin state. Stepping and tapping must be the SAME state, or a
 *                 stepped point cannot be released by tapping it.
 *   total       — how many indices the axis has
 *   isSteppable — optional (i) => boolean. A chart can hold indices with nothing
 *                 to show: an empty histogram bin, or a slot past the end of a
 *                 short player's match list. Those are not stops — the stepper
 *                 walks over them and never counts them, so the readout says
 *                 "3 / 11 bars that exist", not "7 / 30 bins that could".
 *                 Owned HERE rather than in each chart: four of the six needed
 *                 the same rule, and a skipped index must also not be counted,
 *                 which is one decision, not two.
 *   emptyLabel  — readout while nothing is pinned (default 'Tap a point')
 *   prevTitle / nextTitle — button tooltips
 *   trackPrefix — when set, each press dispatches a `shabi:interaction` event
 *                 named `<prefix> back|forward`, so the press is measurable.
 *                 A step is deliberately its own event, separate from a tap:
 *                 this control is built on the claim that the axis cannot be
 *                 navigated by finger, and one event for both would make that
 *                 claim permanently unmeasurable.
 *   describe    — (index) => string appended to the tracked name, so the log
 *                 says WHICH point was stepped to
 * @returns {{ el: HTMLElement, sync: () => void, destroy: () => void }}
 */
export function mountChartStepper(chartHost, {
    controller,
    total,
    isSteppable = null,
    emptyLabel = 'Tap a point',
    prevTitle = 'Previous',
    nextTitle = 'Next',
    trackPrefix = null,
    describe = null,
}) {
    // The stops, in axis order. Computed once — a chart is redrawn by being
    // rebuilt, which re-mounts this bar, so the set cannot go stale under it.
    const stops = [];
    for (let i = 0; i < total; i++) if (!isSteppable || isSteppable(i)) stops.push(i);

    const bar = document.createElement('div');
    bar.className = 'dash-controls chart-step';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.title = prevTitle;
    prev.innerHTML = '&lsaquo;';

    const pos = document.createElement('span');
    pos.className = 'round-label';

    const next = document.createElement('button');
    next.type = 'button';
    next.title = nextTitle;
    next.innerHTML = '&rsaquo;';

    bar.append(prev, pos, next);

    // Above the detail panel when there is one, so the bar reads as part of the
    // axis rather than as a control block below the whole chart.
    const panel = chartHost.querySelector('.chart-info-panel');
    if (panel) chartHost.insertBefore(bar, panel);
    else chartHost.appendChild(bar);

    /** Where the pinned index sits among the stops, or -1 (including "not a stop"). */
    function stopPos() {
        const i = controller.getPinned();
        return i < 0 ? -1 : stops.indexOf(i);
    }

    /** Readout + end-stops, read from whatever the chart currently has pinned. */
    function sync() {
        const k = stopPos();
        pos.textContent = k < 0 ? emptyLabel : `${k + 1} / ${stops.length}`;
        prev.disabled = k === 0 || stops.length === 0;
        next.disabled = (k >= 0 && k === stops.length - 1) || stops.length === 0;
    }

    /**
     * Nothing pinned yet? Start at the LAST stop rather than the first — for a
     * timeline that is the state every other panel on the page is showing, so
     * the first press lands somewhere the reader understands instead of at the
     * far end of the history.
     */
    function step(delta) {
        if (stops.length === 0) return;
        const k = stopPos();
        const target = k < 0 ? stops.length - 1 : Math.min(Math.max(0, k + delta), stops.length - 1);
        const landed = controller.setPinned(stops[target]);
        sync();
        if (trackPrefix) {
            const what = describe ? describe(landed) : '';
            window.dispatchEvent(new CustomEvent('shabi:interaction', {
                detail: { target: `${trackPrefix} ${delta < 0 ? 'back' : 'forward'}${what ? ` — ${what}` : ''}` },
            }));
        }
    }

    const onPrev = () => step(-1);
    const onNext = () => step(1);
    prev.addEventListener('click', onPrev);
    next.addEventListener('click', onNext);
    sync();

    return {
        el: bar,
        sync,
        destroy: () => {
            prev.removeEventListener('click', onPrev);
            next.removeEventListener('click', onNext);
            bar.remove();
        },
    };
}
