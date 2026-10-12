/**
 * clock.js — the server's clock, as seen from this browser.
 *
 * A question's start and deadline are server timestamps. A phone whose own
 * clock is a minute off would otherwise show a countdown that ends a minute
 * early or late, so every countdown is drawn against serverNow(): the local
 * clock plus an offset measured once, at the midpoint of a round trip.
 *
 * This only decides what the countdown LOOKS like. Whether an answer was in
 * time, and how fast it was, is decided by the server's own clock.
 */
import { serverTime } from './api.js';
import { isPreview } from './stateSource.js';

let offset = 0;

export async function syncClock() {
    if (isPreview) return;
    try {
        const sent = Date.now();
        const server = await serverTime();
        const received = Date.now();
        offset = Number(server) - (sent + received) / 2;
    } catch { /* keep the previous offset; the countdown is cosmetic */ }
}

export const serverNow = () => Date.now() + offset;
