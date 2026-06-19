/**
 * sectionCollapse.js — the single collapse behaviour for `.app-section`
 * (pairs with css/sections.css). Used by every page (landing / dashboard /
 * player_general / admin) so section open/close works identically everywhere.
 *
 * wireSectionCollapse(section, { defaultOpen = true, infoBtn = null })
 *   • Marks the section's `.app-section-h2` as collapsible and toggles
 *     `.is-collapsed` on the section (CSS hides everything but the heading).
 *   • `defaultOpen` sets the initial state.
 *   • `infoBtn` (optional) — a clickable element inside the heading (e.g. a
 *     `?` info button) whose clicks must NOT toggle the section.
 *   • Keyboard: Enter / Space toggle; the heading is exposed as role="button".
 */
export function wireSectionCollapse(section, { defaultOpen = true, infoBtn = null } = {}) {
    const h2 = section && section.querySelector(':scope > .app-section-h2');
    if (!h2) return;

    h2.classList.add('is-collapsible');
    h2.setAttribute('role', 'button');
    h2.tabIndex = 0;

    const setOpen = (open) => {
        section.classList.toggle('is-collapsed', !open);
        h2.setAttribute('aria-expanded', String(open));
    };
    setOpen(defaultOpen);

    const toggle = () => setOpen(section.classList.contains('is-collapsed'));

    h2.addEventListener('click', (e) => {
        if (infoBtn && (e.target === infoBtn || infoBtn.contains(e.target))) return;
        toggle();
    });
    h2.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
}
