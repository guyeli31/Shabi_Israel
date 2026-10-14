#!/usr/bin/env node
/**
 * gevkahoot-sounds.mjs — the app's own sound effects, synthesised here.
 *
 *   gevkahoot/assets/sounds/buzzer.wav   the end-of-time buzzer of the action
 *                                        round — a shot-clock horn: two
 *                                        detuned saw-ish tones, slightly
 *                                        clipped, with a hard start
 *
 * These are part of the app (like the tile marks), not quiz media: no quiz
 * picks them, so they live under assets/, not media/. Generated — re-run
 * after changing a sound; `--check` verifies the committed file matches.
 *
 *     node scripts/gevkahoot-sounds.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gevkahoot', 'assets', 'sounds');
const check = process.argv.includes('--check');
let stale = 0;

function wav(file, seconds, sample) {
    const rate = 22050;
    const n = Math.round(rate * seconds);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
        data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / rate))) * 32767), i * 2);
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
    head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32);
    head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
    const bytes = Buffer.concat([head, data]);
    const target = path.join(OUT, file);
    if (check) {
        const same = fs.existsSync(target) && fs.readFileSync(target).equals(bytes);
        if (!same) { stale += 1; console.log(`✗ assets/sounds/${file} is out of date`); } else console.log(`✓ assets/sounds/${file}`);
        return;
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(target, bytes);
    console.log(`assets/sounds/${file}`);
}

// A band-limited sawtooth (the first harmonics), so the horn is bright but
// not aliased at this sample rate.
const saw = (f, t) => {
    let v = 0;
    for (let k = 1; k <= 12; k++) v += Math.sin(2 * Math.PI * f * k * t) / k;
    return v * 0.55;
};

// The buzzer: 1.3 s, two tones a quarter-tone apart (the beating is what
// makes a horn sound like a horn), soft-clipped, full on at once and cut off
// with a short tail.
wav('buzzer.wav', 1.3, (t) => {
    const env = Math.min(1, t * 200) * (t < 1.15 ? 1 : Math.max(0, 1 - (t - 1.15) / 0.15));
    const v = saw(196, t) + saw(201.8, t) * 0.85 + Math.sin(2 * Math.PI * 98 * t) * 0.3;
    return Math.tanh(v * 1.6) * 0.62 * env;
});

if (check && stale) process.exit(1);
