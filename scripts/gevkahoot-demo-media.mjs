#!/usr/bin/env node
/**
 * gevkahoot-demo-media.mjs — generate the demo quiz's video and audio.
 *
 * The demo quiz (gevkahoot/js/demo/demoQuiz.js) must not depend on anyone's real
 * footage or music, so its media are synthetic and made here:
 *
 *   media/videos/demo-clip.mp4   three balls bouncing across a pitch, silent
 *   media/audio/demo-loop.wav    a soft arpeggio — the background music
 *   media/audio/demo-beeps.wav   four beeps — the audio interlude
 *
 * Two of the demo questions ask about them ("how many balls?", "how many
 * beeps?"), so if the content here changes, the answers in demoQuiz.js and in
 * sql/gevkahoot_demo_seed.sql change with it.
 *
 * The video is drawn on a canvas in a headless browser and captured with
 * MediaRecorder (H.264 in MP4), in real time — the script takes about as long
 * as the clip. No page of the site is opened.
 *
 *     node scripts/gevkahoot-demo-media.mjs
 *     node scripts/gevkahoot-media-manifest.mjs     ← afterwards
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const MEDIA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gevkahoot', 'media');

// ---- audio ----------------------------------------------------------------
function wav(file, seconds, sample) {
    const rate = 11025;
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
    fs.writeFileSync(path.join(MEDIA, 'audio', file), Buffer.concat([head, data]));
    console.log(`audio/${file}`);
}

const tone = (f, t) => Math.sin(2 * Math.PI * f * t);

// Background loop: sixteen plucked notes over eight seconds.
const NOTES = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23, 440.0, 587.33, 440.0, 349.23, 246.94, 293.66, 392.0, 493.88];
wav('demo-loop.wav', 8, (t) => {
    const step = 0.5;
    const f = NOTES[Math.floor(t / step) % NOTES.length];
    const local = t % step;
    const env = Math.min(1, local * 40) * Math.exp(-local * 3.2);
    return (tone(f, local) * 0.6 + tone(f * 2, local) * 0.18 + tone(f / 2, local) * 0.22) * env * 0.5;
});

// The audio interlude: exactly FOUR beeps, rising, clearly separated.
const BEEPS = [[0.6, 660], [1.7, 740], [2.8, 830], [3.9, 990]];
wav('demo-beeps.wav', 5.2, (t) => {
    for (const [at, f] of BEEPS) {
        const local = t - at;
        if (local >= 0 && local < 0.42) {
            const env = Math.min(1, local * 60) * Math.min(1, (0.42 - local) * 25);
            return (tone(f, local) * 0.7 + tone(f * 2, local) * 0.2) * env * 0.6;
        }
    }
    return 0;
});

// ---- video ----------------------------------------------------------------
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
// No site page is opened here, but the standing rule for every browser-driving
// script is that it opts out of analytics before any navigation.
await context.addInitScript(() => { try { localStorage.setItem('shabi:no-analytics', '1'); } catch {} });
const page = await context.newPage();

const base64 = await page.evaluate(async () => {
    const W = 960, H = 540, SECONDS = 7;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    // Exactly THREE balls. Each has its own colour, size and bounce rhythm.
    const balls = [
        { color: '#ffd60a', r: 46, speed: 0.20, phase: 0.0, hop: 1.9 },
        { color: '#ff5ca8', r: 36, speed: 0.27, phase: 0.35, hop: 2.6 },
        { color: '#19e3ff', r: 28, speed: 0.34, phase: 0.7, hop: 3.3 },
    ];
    const draw = (t) => {
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#1c2a6b'); sky.addColorStop(0.6, '#0f5d3a'); sky.addColorStop(1, '#0a3f25');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 8; i += 2) { ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(i * 120, 360, 120, 180); }
        ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(0, 440); ctx.lineTo(W, 440); ctx.stroke();
        for (const b of balls) {
            const x = ((t * b.speed + b.phase) % 1.2 - 0.1) * W;
            const bounce = Math.abs(Math.sin(t * b.hop + b.phase * 6));
            const y = 440 - b.r - bounce * 250;
            ctx.fillStyle = 'rgba(0,0,0,.28)';
            ctx.beginPath(); ctx.ellipse(x, 446, b.r * (1.1 - bounce * 0.5), b.r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = b.color;
            ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.55)';
            ctx.beginPath(); ctx.arc(x - b.r * 0.3, y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#fff'; ctx.font = '800 54px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('GEVKAHOOT', W / 2, 78);
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 24px system-ui, sans-serif';
        ctx.fillText('demo clip', W / 2, 112);
    };

    const type = 'video/mp4;codecs=avc1.42E01E';
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 1_400_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    const started = performance.now();
    recorder.start();
    await new Promise((resolve) => {
        const frame = (now) => {
            const t = (now - started) / 1000;
            draw(t);
            if (t < SECONDS) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
    });
    recorder.stop();
    await done;
    const buffer = await new Blob(chunks, { type }).arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
});
await browser.close();

fs.writeFileSync(path.join(MEDIA, 'videos', 'demo-clip.mp4'), Buffer.from(base64, 'base64'));
console.log('videos/demo-clip.mp4');
