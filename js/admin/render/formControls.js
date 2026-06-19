// render/formControls.js — shared admin form-control markup.
//
// Single source of truth for the "file picker" control used across the
// admin edit/create-league menus (Upload CSV, Upload Custom Flag, player
// flag upload). The visible "Choose File" label reuses the button
// primitive (.btn .btn-secondary .btn-sm) so there is exactly one button
// definition — see css/admin.css and v2/docs/MIGRATION-FROM-V1.md.

/**
 * A hidden <input type=file> fronted by a styled label button + filename.
 * Wiring (updating the filename span on change) lives with each caller;
 * the span carries `data-for="<id>"` so existing handlers keep working.
 *
 * @param {string} id — id of the file input (and the label's `for`).
 * @param {object} [opts]
 * @param {string} [opts.label="Choose File"] — label button text.
 * @param {string} [opts.accept=".csv,.xlsx"] — input accept filter.
 * @returns {string} HTML string.
 */
export function filePickerHTML(id, { label = 'Choose File', accept = '.csv,.xlsx' } = {}) {
    return `<div class="custom-file-input">
        <label class="btn btn-secondary btn-sm" for="${id}">${label}</label>
        <input type="file" id="${id}" accept="${accept}">
        <span class="file-name" data-for="${id}">No file chosen</span>
    </div>`;
}
