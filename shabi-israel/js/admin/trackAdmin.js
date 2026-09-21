/**
 * trackAdmin.js — one place every admin surface announces an operator action to
 * analytics. The public site's delegated click listener (js/analytics.js) only
 * auto-catches `.btn-success`/`.btn-primary` (as `Action: <label> (Admin Mode)`)
 * and sidebar nav (`Menu: …`); everything else — per-row buttons, and above all
 * the MANY manual-entry forms — was invisible. These helpers make an action
 * explicit and, per the agreed policy, describe a Save by the FIELDS it changed.
 *
 * Grammar (matches the site's "Prefix: detail" vocabulary, admin-suffixed):
 *   "<Section>: <action>[ — <subject>][ [field: old→new; …]] (Admin Mode)"
 *
 * Policy decisions carried here:
 *   • Manual fields are reported ONLY at Save, as one summary of what changed —
 *     never per keystroke (readFields snapshot at open, diffFields at save).
 *   • The summary carries OLD→NEW values, because the operator asked to see them.
 *   • SECRETS ARE NEVER A FIELD. A password or PAT is not passed to readFields;
 *     login records only success/failure. This is an invariant, not a toggle —
 *     "include old→new" does not extend to a credential.
 */

/** Dispatch one admin analytics event. The `(Admin Mode)` suffix is added here so
 *  every call site reads identically and none can forget it. Best-effort: a
 *  tracking failure must never break an admin action. */
export function trackAdmin(target) {
    try {
        window.dispatchEvent(new CustomEvent('shabi:interaction', {
            detail: { target: `${target} (Admin Mode)` },
        }));
    } catch { /* analytics is best-effort */ }
}

/** Read a set of form controls into a plain { label: stringValue } snapshot.
 *  `spec` maps a human label to a CSS selector or an element. Checkboxes read as
 *  'true'/'false'; everything else as its trimmed value. Missing controls are
 *  skipped (a form that doesn't render a field simply can't diff it). */
export function readFields(spec, root = document) {
    const out = {};
    for (const [label, ref] of Object.entries(spec)) {
        const el = typeof ref === 'string' ? root.querySelector(ref) : ref;
        if (!el) continue;
        out[label] = el.type === 'checkbox' ? String(el.checked) : String(el.value ?? '').trim();
    }
    return out;
}

/** "field: old→new; field2: old→new" over two readFields() snapshots — only the
 *  fields that actually changed. An empty value renders as ∅ so a set/cleared is
 *  legible. Returns '' when nothing changed (the caller then omits the bracket). */
export function diffFields(before, after) {
    const parts = [];
    for (const label of Object.keys(after)) {
        const a = before[label] ?? '';
        const b = after[label] ?? '';
        if (a !== b) parts.push(`${label}: ${a || '∅'}→${b || '∅'}`);
    }
    return parts.join('; ');
}

/** Compose the trailing " [<diff>]" for a Save event, or '' when nothing moved. */
export function fieldList(before, after) {
    const sum = diffFields(before, after);
    return sum ? ` [${sum}]` : '';
}
