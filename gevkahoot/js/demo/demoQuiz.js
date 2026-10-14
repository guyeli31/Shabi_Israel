/**
 * demoQuiz.js — the content of the demo quiz anyone can play against bots.
 *
 * Deliberately a tour of everything a quiz can hold: every kind of scored
 * item (question, complete the picture, slider, ranking, spot it, puzzle),
 * an "answer explained" segment, interludes before and after questions in
 * every media kind (image, video, audio) and layout (side, top, full,
 * background), emoji in questions, in answers and on tiles, weights ×0 / ×1 /
 * ×2, one and several right answers, and per-element overrides of the music
 * and the bouncing animation.
 *
 * All of it is invented and all the media are synthetic
 * (scripts/gevkahoot-demo-media.mjs). The shape of an item is the gk_items row
 * shape, so sql/gevkahoot_demo_seed.sql is the same quiz for a real, hosted run
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
    // A football drifting behind the questions shows the animation option off
    // without getting in anyone's way.
    anim: { on: true, sprite: 'media/sprites/demo-ball.svg', count: 5, size: 11, speed: 3, front: false },
};

const item = (row) => ({
    body: '', options: [], regions: [], correct: [], weight: 1, time_limit_s: 20,
    image: null, video: null, audio: null, media_layout: 'side', music_on: true, anim_on: true,
    music: null, anim_sprite: null, symbols: [], marks: 'teams', explain: null, slot: null, ...row,
});

export const DEMO_ITEMS = [
    // ---- opening: an interlude with a picture beside the text ----------------
    item({ id: 'demo-i1', kind: 'interlude', title: '👋 ברוכים הבאים לחידון לדוגמה',
        body: 'סיור בכל סוגי השאלות מול שחקנים וירטואליים. עונים מהר ונכון — הזמן שווה נקודות! 🏆',
        image: 'media/images/demo-ball.svg', seconds: 7 }),

    // ×0 warm-up: the emoji mark set — an emoji of the author's choice on each
    // tile instead of the team crests — and
    // emoji in the question and in the answers.
    item({ id: 'demo-q1', kind: 'question', title: '🔥 חימום: כמה צלעות יש למשולש?',
        options: ['3️⃣ שלוש', '4️⃣ ארבע'], correct: [0], weight: 0, time_limit_s: 10, marks: 'emoji', symbols: ['🔺', '🟦'] }),

    // A picture beside the question, two right answers out of four — and this
    // element brings its own bouncing picture (a sun instead of the quiz's ball).
    item({ id: 'demo-q2', kind: 'question', title: 'אילו צורות מופיעות בתמונה? 👀',
        options: ['🔺 משולש', '🟥 ריבוע', '⚪ עיגול', '⭐ כוכב'], correct: [0, 2], weight: 1, time_limit_s: 20,
        image: 'media/images/demo-shapes.svg', anim_sprite: 'media/sprites/demo-sun.svg' }),

    // An interlude BEFORE a question: a video above the text.
    item({ id: 'demo-i2', kind: 'interlude', title: '🎬 צפו היטב', body: 'השאלה הבאה היא על הסרטון.',
        video: 'media/videos/demo-clip.mp4', media_layout: 'top', seconds: 8 }),

    // This one carries Catan terrain tiles as its marks, and an "answer explained" segment: shown after the reveal,
    // before the fastest five and the table.
    item({ id: 'demo-q3', kind: 'question', title: 'כמה כדורים קפצו בסרטון? ⚽',
        options: ['2', '3', '4'], correct: [1], weight: 1, time_limit_s: 15, marks: 'catan',
        explain: item({ id: 'demo-q3-x', kind: 'explain', title: '💡 שלושה כדורים', seconds: 6,
            body: 'צהוב, ורוד ותכלת — כל אחד בגודל ובקצב קפיצה משלו.', image: 'media/images/demo-ball.svg' }) }),

    // An audio interlude: the quiz's music steps aside while it plays.
    item({ id: 'demo-i3', kind: 'interlude', title: '🎧 עכשיו מקשיבים', body: 'ספרו את הצפצופים.',
        audio: 'media/audio/demo-beeps.wav', seconds: 7 }),

    // No background music on this one (per-element "none"), so nothing covers
    // the memory of the beeps. Its marks are electronic parts.
    item({ id: 'demo-q4', kind: 'question', title: 'כמה צפצופים נשמעו? 🔔',
        options: ['3', '4', '5', '6'], correct: [1], weight: 1, time_limit_s: 12, music_on: false, marks: 'circuit' }),

    // An interlude AFTER a question, opening the picture games: a full-width
    // picture, and no bouncing animation over it.
    item({ id: 'demo-i4', kind: 'interlude', title: '🖼️ ועכשיו — משחקי תמונה',
        body: 'לפני כל אחד מהם: שקופית קצרה שמראה איך משחקים.', image: 'media/images/demo-puzzle.svg',
        media_layout: 'full', anim_on: false, seconds: 6 }),

    // "Complete the picture": the sun is missing; four suns of different
    // sizes to try in its place, and only the third is the real size.
    item({ id: 'demo-c1', kind: 'complete', title: '☀️ איזו שמש משלימה את התמונה?', correct: [2], weight: 1, time_limit_s: 20,
        image: 'media/images/demo-complete.svg', slot: { x: 0.6413, y: 0.0417, w: 0.2975, h: 0.3967 },
        options: [0.55, 1.35, 1, 0.78].map((scale) => ({ image: 'media/sprites/demo-sun.svg', scale })) }),

    // The slider: the house is taken out, and put back at whatever size the
    // player slides it to. A house emoji rides on the handle.
    item({ id: 'demo-sl1', kind: 'slider', title: '🎚️ באיזה גודל הבית באמת?', correct: [900], weight: 1, time_limit_s: 20,
        image: 'media/images/demo-slider.svg', slot: { x: 0.115, y: 0.37, w: 0.3325, h: 0.4533 },
        options: [{ image: 'media/sprites/demo-house.svg', scale: 1 }], symbols: ['🏠'] }),

    // The ranking: biggest at the top. Stored scrambled (as the editor
    // stores them); `correct` is the right order, top place first.
    item({ id: 'demo-r1', kind: 'rank', title: '🔢 סדרו מהגדול לקטן', body: 'גדול', weight: 1, time_limit_s: 25,
        options: ['🐘 פיל', '🐋 לוויתן', '🐈 חתול', '🐎 סוס'], correct: [1, 0, 3, 2] }),

    // "Spot it": four rectangles on the picture, one of them right.
    item({ id: 'demo-s1', kind: 'spot', title: '🔎 איפה הכדור?', correct: [3], weight: 1, time_limit_s: 15,
        image: 'media/images/demo-puzzle.svg',
        regions: [
            { x: 0.11, y: 0.36, w: 0.34, h: 0.48 },   // the house
            { x: 0.62, y: 0.03, w: 0.34, h: 0.42 },   // the sun
            { x: 0.62, y: 0.52, w: 0.19, h: 0.34 },   // the tree
            { x: 0.5, y: 0.78, w: 0.13, h: 0.17 },    // the ball
        ] }),

    // The puzzle: five pieces of the picture, dragged into place. `circle` is
    // the round detail (the sun) that bounces around once it is revealed.
    item({ id: 'demo-p1', kind: 'puzzle', title: '🧩 הרכיבו את התמונה', correct: [0], weight: 1, time_limit_s: 40,
        image: 'media/images/demo-puzzle.svg', circle: { x: 0.79, y: 0.24, r: 0.2 } }),

    // The double-points finale, its picture as the whole background.
    item({ id: 'demo-q5', kind: 'question', title: '🏁 שאלת הסיום: אילו מהמספרים זוגיים?',
        options: ['7', '12', '15', '20', '33'], correct: [1, 3], weight: 2, time_limit_s: 30,
        image: 'media/backgrounds/demo-pitch.svg', media_layout: 'background' }),

    // An interlude after the last question, before the podium.
    item({ id: 'demo-i5', kind: 'interlude', title: '🎉 זהו, סיימנו!', body: 'ועכשיו — מי ניצח? 🥁',
        image: 'media/images/demo-ball.svg', media_layout: 'top', seconds: 5 }),
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
