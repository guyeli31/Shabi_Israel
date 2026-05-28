// primitives/FormField/formField.js — labelled input/textarea/select.
//
// Composes a single field block with optional hint + error. The control
// element is created with the requested `type` (text by default, or
// `textarea`, `select`). For `select`, pass `options: [{value, label}, ...]`.

let _uid = 0;
function uniqueId(prefix = "field") {
    _uid += 1;
    return `${prefix}-${_uid}`;
}

/**
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.id]
 * @param {string} [props.name]
 * @param {string} [props.type="text"] — text/email/number/password/textarea/select.
 * @param {string} [props.value]
 * @param {string} [props.placeholder]
 * @param {string} [props.hint]
 * @param {string} [props.error]
 * @param {boolean} [props.required]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.inline]
 * @param {Array<{value: string, label: string}>} [props.options] — for select.
 * @param {(e: Event) => void} [props.onInput]
 * @param {(e: Event) => void} [props.onChange]
 * @param {string} [props.className]
 * @returns {HTMLDivElement}
 */
export function render(props = {}) {
    const {
        label, id, name, type = "text", value, placeholder, hint, error,
        required, disabled, inline, options, onInput, onChange, className,
    } = props;

    const fieldId = id || uniqueId();
    const wrap = document.createElement("div");
    let cls = "field";
    if (inline) cls += " field--inline";
    if (error)  cls += " field--error";
    if (className) cls += " " + className;
    wrap.className = cls;

    const lab = document.createElement("label");
    lab.className = "field__label";
    lab.htmlFor = fieldId;
    lab.textContent = label ?? "";
    if (required) {
        const star = document.createElement("span");
        star.className = "field__required";
        star.textContent = "*";
        star.setAttribute("aria-hidden", "true");
        lab.appendChild(star);
    }
    wrap.appendChild(lab);

    let control;
    if (type === "textarea") {
        control = document.createElement("textarea");
        control.className = "field__textarea";
        if (value != null) control.value = value;
    } else if (type === "select") {
        control = document.createElement("select");
        control.className = "field__select";
        for (const opt of options ?? []) {
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.label;
            if (opt.value === value) o.selected = true;
            control.appendChild(o);
        }
    } else {
        control = document.createElement("input");
        control.type = type;
        control.className = "field__input";
        if (value != null) control.value = value;
    }
    control.id = fieldId;
    if (name) control.name = name;
    if (placeholder) control.placeholder = placeholder;
    if (required) control.required = true;
    if (disabled) control.disabled = true;
    if (error) control.setAttribute("aria-invalid", "true");

    if (onInput)  control.addEventListener("input", onInput);
    if (onChange) control.addEventListener("change", onChange);

    wrap.appendChild(control);

    if (hint && !error) {
        const h = document.createElement("div");
        h.className = "field__hint";
        h.textContent = hint;
        wrap.appendChild(h);
    }
    if (error) {
        const e = document.createElement("div");
        e.className = "field__error";
        e.setAttribute("role", "alert");
        e.textContent = error;
        wrap.appendChild(e);
    }
    return wrap;
}
