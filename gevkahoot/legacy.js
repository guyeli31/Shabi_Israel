/*
 * legacy.js — the one file in gevkahoot/ written as old JavaScript (ES5, a
 * classic script, no arrow functions, no modules), so that it runs where the
 * quiz cannot: an iPhone 5 stops at iOS 10.3, whose Safari cannot even parse
 * the quiz's modules (optional chaining and the rest arrived in 2020), and the
 * player saw an empty page. This puts a message there instead.
 *
 * Two signs the quiz will not start: the browser has no ES modules at all
 * (the module <script> is silently skipped), or a module failed to PARSE (a
 * SyntaxError reported to the window). When the quiz does start, gkPlayer.js
 * removes the message if it was shown by mistake.
 */
(function () {
    var shown = false;
    function show() {
        if (shown) return;
        var app = document.getElementById('app');
        if (!app) { document.addEventListener('DOMContentLoaded', show); return; }
        shown = true;
        var box = document.createElement('div');
        box.className = 'pl-legacy';
        var title = document.createElement('p');
        title.className = 'pl-legacy-title';
        title.appendChild(document.createTextNode('הדפדפן במכשיר הזה ישן מדי בשביל החידון'));
        var text = document.createElement('p');
        text.appendChild(document.createTextNode('אפשר לעדכן את מערכת ההפעלה של המכשיר, או להצטרף מטלפון אחר.'));
        box.appendChild(title);
        box.appendChild(text);
        app.appendChild(box);
    }
    var probe = document.createElement('script');
    if (!('noModule' in probe)) show();
    window.addEventListener('error', function (e) {
        if (e && /SyntaxError/.test(String(e.message))) show();
    });
})();
