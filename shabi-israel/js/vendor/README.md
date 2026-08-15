# js/vendor/

Third-party libraries vendored (checked into the repo) instead of imported
from a CDN at runtime. This project has **no build step** (see CLAUDE.md), so
the browser loads these files directly like any other static asset.

## Why vendored, not CDN

`js/data/supabaseClient.js` used to import supabase-js from
`https://esm.sh/@supabase/supabase-js@2`. That put a **third-party host on the
critical path of every page**: a static `import` blocks all app code until it
resolves, has no timeout (you cannot `AbortController` a static import), and on
a flaky mobile connection a failed hop to esm.sh left the page stuck on
"Loading…" with the analytics beacon (which lives downstream of that same
import) never firing. It also disclosed every visitor's IP to esm.sh/Cloudflare
— at odds with the privacy notice's "we do not store IP addresses" promise.

Vendoring collapses that to **one origin**: if the visitor reached the site at
all, they already have everything needed. No second connection, no external
point of failure, no visitor IP leaving for a third party.

## supabase-js@2.110.7.mjs

- **Package:** `@supabase/supabase-js`
- **Version:** `2.110.7` (pinned — this is what `@2` resolved to on esm.sh at
  vendoring time, 2026-07-10; pinning removes the silent floating-version risk).
- **Format:** single self-contained ES module, all sub-packages
  (auth-js/postgrest-js/realtime-js/storage-js/functions-js) inlined. Zero
  external imports — verified with `grep`.
- **Exports:** `createClient`, `SupabaseClient`, and the usual error/enum
  exports — a drop-in for the old esm.sh import.

### How it was built (reproducible)

```bash
# in a scratch dir
npm install @supabase/supabase-js@2.110.7
printf "export * from '@supabase/supabase-js';\n" > entry.mjs
esbuild entry.mjs --bundle --format=esm --platform=browser \
  --target=es2020 --minify --outfile=supabase-js@2.110.7.mjs
```

### Upgrading

Bump the version in the command above, rebuild, replace the file, update the
import path in `js/data/supabaseClient.js`, and re-run the browser smoke test
(load any page, confirm the league table renders — that exercises a real
`createClient` → RPC round trip). Keep the version in the filename so the
import path changing is a visible, reviewable diff.
