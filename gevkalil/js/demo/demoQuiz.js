/**
 * demoQuiz.js — the content of the demo quiz anyone can play against bots.
 *
 * Deliberately a small tour of everything a quiz can hold: an interlude of
 * each media kind (image, video, audio), and five questions that differ in
 * every dimension — 2 to 5 options, 10 to 30 seconds, weights ×0 / ×1 / ×2,
 * some with one correct answer and some with several.
 *
 * All of it is invented and all the media are synthetic
 * (scripts/gevkalil-demo-media.mjs). The shape of an item is the gk_items row
 * shape, so sql/gevkalil_demo_seed.sql is the same quiz for a real, hosted run
 * — keep the two in step.
 *
 * Unlike a live quiz, the correct answers ARE in the browser here. That is
 * fine: there is no one to cheat — the opponents are bots and nothing is
 * stored.
 */

export const DEMO_QUIZ = {
    title: 'חידון לדוגמה',
    theme: 'stadium',
    background: null,
    music: 'media/audio/demo-loop.wav',
    music_on: true,
    lead_in_s: 3,
};

const item = (row) => ({
    body: '', options: [], correct: [], weight: 1, time_limit_s: 20,
    image: null, video: null, audio: null, media_layout: 'side', music_on: true, ...row,
});

export const DEMO_ITEMS = [
    item({ id: 'demo-i1', kind: 'interlude', title: 'ברוכים הבאים לחידון לדוגמה',
        body: 'חמש שאלות מול שחקנים וירטואליים. עונים מהר ונכון — הזמן שווה נקודות.',
        image: 'media/images/demo-ball.svg', seconds: 7 }),

    item({ id: 'demo-q1', kind: 'question', title: 'חימום: כמה צלעות יש למשולש?',
        options: ['3', '4'], correct: [0], weight: 0, time_limit_s: 10 }),

    item({ id: 'demo-q2', kind: 'question', title: 'אילו צורות מופיעות בתמונה?',
        options: ['משולש', 'ריבוע', 'עיגול', 'כוכב'], correct: [0, 2], weight: 1, time_limit_s: 20,
        image: 'media/images/demo-shapes.svg' }),

    item({ id: 'demo-i2', kind: 'interlude', title: 'צפו היטב', body: 'השאלה הבאה היא על הסרטון.',
        video: 'media/videos/demo-clip.mp4', media_layout: 'top', seconds: 8 }),

    item({ id: 'demo-q3', kind: 'question', title: 'כמה כדורים קפצו בסרטון?',
        options: ['2', '3', '4'], correct: [1], weight: 1, time_limit_s: 15 }),

    item({ id: 'demo-i3', kind: 'interlude', title: 'עכשיו מקשיבים', body: 'ספרו את הצפצופים.',
        audio: 'media/audio/demo-beeps.wav', seconds: 7 }),

    item({ id: 'demo-q4', kind: 'question', title: 'כמה צפצופים נשמעו?',
        options: ['3', '4', '5', '6'], correct: [1], weight: 1, time_limit_s: 12 }),

    item({ id: 'demo-q5', kind: 'question', title: 'שאלת הסיום: אילו מהמספרים זוגיים?',
        options: ['7', '12', '15', '20', '33'], correct: [1, 3], weight: 2, time_limit_s: 30,
        image: 'media/backgrounds/demo-pitch.svg', media_layout: 'background' }),
];

/** The bots: a name, how often they are right, and how fast they tend to be
 *  (the fraction of the time limit their answers centre on). */
export const DEMO_BOTS = [
    { name: 'רובי הרובוט', skill: 0.92, pace: 0.22 },
    { name: 'דנה 3000', skill: 0.85, pace: 0.35 },
    { name: 'קפטן פיקסל', skill: 0.78, pace: 0.28 },
    { name: 'סבתא טורבו', skill: 0.74, pace: 0.5 },
    { name: 'מר ביט', skill: 0.7, pace: 0.4 },
    { name: 'לולה לוגיקה', skill: 0.66, pace: 0.3 },
    { name: 'ג׳ינג׳י 2.0', skill: 0.6, pace: 0.55 },
    { name: 'צ׳יפ', skill: 0.55, pace: 0.2 },
    { name: 'נועה נוירון', skill: 0.5, pace: 0.6 },
    { name: 'בוט שישי', skill: 0.42, pace: 0.45 },
    { name: 'אלגו', skill: 0.36, pace: 0.7 },
];
