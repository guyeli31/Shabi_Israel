// components/Breadcrumbs/breadcrumbs.js — segmented chevron trail.
// Last crumb is rendered as plain text (current page), all others as
// links. Returns the <nav> element.

/**
 * @param {object} props
 * @param {Array<{label:string, href?:string}>} props.crumbs
 * @returns {HTMLElement}
 */
export function render({ crumbs = [] } = {}) {
    const nav = document.createElement("nav");
    nav.className = "breadcrumbs";
    nav.setAttribute("aria-label", "Breadcrumb");

    const ol = document.createElement("ol");
    ol.className = "breadcrumbs__list";

    crumbs.forEach((crumb, i) => {
        const li = document.createElement("li");
        const isLast = i === crumbs.length - 1;
        li.className = "breadcrumbs__crumb" + (isLast ? " breadcrumbs__crumb--current" : "");
        if (isLast) {
            li.setAttribute("aria-current", "page");
            li.textContent = crumb.label;
        } else {
            const a = document.createElement("a");
            a.className = "breadcrumbs__link";
            a.href = crumb.href ?? "#";
            a.textContent = crumb.label;
            li.appendChild(a);
        }
        ol.appendChild(li);
    });

    nav.appendChild(ol);
    return nav;
}
