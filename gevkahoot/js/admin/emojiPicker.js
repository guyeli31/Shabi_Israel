/**
 * emojiPicker.js — pick an emoji with the mouse.
 *
 * A phone has an emoji keyboard; a desktop, for most people, effectively does
 * not. This is the "+" beside the editor's text fields: a small panel of
 * common emoji, grouped, that inserts the chosen one where the cursor is — or
 * hands it to a callback (the per-answer tile symbol).
 *
 * The list is plain text in this file: no font, no image sheet and no library
 * is loaded — each emoji is drawn by the device's own emoji font.
 */
import { h, clear } from '../ui/dom.js';

const GROUPS = [
    ['😀', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🧐 🤔 🤨 😐 😶 🙄 😏 😬 😴 🤒 🤢 🤮 🥵 🥶 😱 😭 😡 🤬 🤯 🥳 😈 👻 💀 🤡 💩 🙈 🙉 🙊'],
    ['👍', '👍 👎 👏 🙌 🙏 💪 🤝 ✌️ 🤞 🤟 🤘 👌 🤌 👈 👉 👆 👇 ☝️ ✋ 🖐️ 👋 🖕 ✊ 👊 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 💥 💫 ⭐ 🌟 ✨ 🔥 💧 💤'],
    ['⚽', '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥅 ⛳ 🏆 🥇 🥈 🥉 🏅 🎖️ 🎯 🎲 🎮 🕹️ 🧩 ♟️ 🎳 🚴 🏊 🏃 🤸 ⛹️ 🏋️ 🤾 🧗 🏄'],
    ['🎉', '🎉 🎊 🎈 🎁 🎂 🍰 🍕 🍔 🌭 🍟 🌮 🥙 🍣 🍩 🍪 🍫 🍿 🍺 🍻 🥂 🍷 🥃 🍹 ☕ 🧃 🍎 🍌 🍉 🍇 🍓 🍒 🍋 🥑 🌶️ 🧄'],
    ['🐶', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦅 🦉 🐴 🦄 🐝 🦋 🐢 🐍 🐙 🦈 🐬 🐳 🐘 🦒 🦖 🌵 🌲 🌴 🌸 🌹 🌻 🍀'],
    ['🚗', '🚗 🚕 🚌 🚓 🚑 🚒 🚚 🚜 🏎️ 🏍️ 🚲 ✈️ 🚀 🛸 🚁 ⛵ 🚢 🚂 🏠 🏰 🏟️ 🗽 🗼 ⛰️ 🏖️ 🏝️ 🌍 🌙 ☀️ ⛅ 🌧️ ⛈️ ❄️ 🌈 ⚡'],
    ['💡', '💡 📱 💻 ⌨️ 🖥️ 📷 🎥 📺 📻 🎙️ 🎧 🎵 🎶 🎸 🥁 🎹 🎺 🎻 🎤 📚 📖 ✏️ 📌 📎 ✂️ 🔑 🔒 🔨 🧲 💣 💰 💎 👑 🎓 👓 👕 👟 ⏰ ⏳ 🔔'],
    ['✅', '✅ ❌ ❓ ❗ ⚠️ 🚫 ⛔ 🆗 🆒 🆕 🔝 ➕ ➖ ✖️ ➗ ♾️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🔺 🔻 🔶 🔷 ⬆️ ⬇️ ⬅️ ➡️ 🔄 ▶️ ⏸️ ⏹️ 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟'],
];

let panel = null;
let onPick = null;

function build() {
    const grid = h('div', { class: 'ep-grid' });
    const show = (list) => {
        clear(grid);
        for (const emoji of list.split(' ')) {
            grid.append(h('button', { class: 'ep-emoji', type: 'button', text: emoji, onclick: () => { const cb = onPick; close(); cb?.(emoji); } }));
        }
    };
    const tabs = h('div', { class: 'ep-tabs', role: 'tablist' }, GROUPS.map(([icon, list], i) => {
        const tab = h('button', { class: 'ep-tab', type: 'button', role: 'tab', text: icon, onclick: () => {
            for (const t of tabs.children) t.toggleAttribute('data-on', t === tab);
            show(list);
        } });
        if (i === 0) tab.toggleAttribute('data-on', true);
        return tab;
    }));
    show(GROUPS[0][1]);
    panel = h('div', { class: 'ep kit', role: 'dialog', 'aria-label': 'בחירת אימוג׳י', hidden: true }, tabs, grid);
    document.body.append(panel);
    // Anywhere else closes it — but not the press that is opening it.
    document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !e.target.closest?.('[data-emoji-opener]')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function close() {
    if (panel) panel.hidden = true;
    onPick = null;
}

/** Open the panel beside `anchor`; `pick` receives the chosen emoji. */
export function openEmojiPicker(anchor, pick) {
    if (!panel) build();
    onPick = pick;
    panel.hidden = false;
    // Inside a <dialog> shown modally only the dialog's own subtree is
    // clickable, so the panel moves in with whoever opened it.
    (anchor.closest('dialog') || document.body).append(panel);
    const a = anchor.getBoundingClientRect();
    const w = panel.offsetWidth, hgt = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(a.left, innerWidth - w - 8))}px`;
    panel.style.top = `${a.bottom + hgt + 8 > innerHeight ? Math.max(8, a.top - hgt - 6) : a.bottom + 6}px`;
}

/**
 * The "+" for a text field: inserts the emoji at the cursor (replacing any
 * selection), keeps the focus in the field, and fires `input` so whatever is
 * listening for typing hears it too.
 */
export function emojiButton(field) {
    const button = h('button', { class: 'ep-open', type: 'button', title: 'הוספת אימוג׳י', 'aria-label': 'הוספת אימוג׳י', text: '+', dataset: { emojiOpener: '' } });
    button.addEventListener('click', () => openEmojiPicker(button, (emoji) => {
        const start = field.selectionStart ?? field.value.length;
        const end = field.selectionEnd ?? start;
        field.value = field.value.slice(0, start) + emoji + field.value.slice(end);
        field.focus();
        field.setSelectionRange(start + emoji.length, start + emoji.length);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    return h('span', { class: 'ep-wrap' }, field, button);
}
