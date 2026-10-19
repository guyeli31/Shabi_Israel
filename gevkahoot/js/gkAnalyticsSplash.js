/**
 * gkAnalyticsSplash.js — wakes analytics.html's loading screen NOW.
 *
 * The main site's analytics page does this with an inline
 * `import './js/utils/splash.js'`: the page's own module only runs once its
 * whole import graph (Supabase client, tabs, theme picker…) has loaded, and
 * until then the splash would sit frozen. This entry's graph is two small
 * files, so it runs at DOMContentLoaded. A file rather than an inline module
 * because of the page's CSP; one shared instance with gkAnalytics.js (the
 * same URL here, a shared chunk in the build, which splits).
 */
import '../../shabi-israel/js/utils/splash.js';
