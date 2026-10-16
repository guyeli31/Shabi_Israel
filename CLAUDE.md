# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## v2 rebuild in progress — see `v2/`

A parallel clean-slate rebuild lives under `v2/` and is the end-state target. Plan: `C:\Users\User\.claude\plans\sharded-gliding-locket.md`. While the rebuild is in progress:

- **v1 (current production)** at `shabi-israel/` keeps running. Serve via `npx http-server -p 8090 --cors -c-1` from repo root → `http://localhost:8090/shabi-israel/`.
- **v2 (rebuild)** at `v2/` uses Vite. `cd v2 && npm install && npm run dev` → `http://localhost:5173`.
- Both versions share `leagues/` at the repo root. v1 reads via `fetch('leagues/...')`. v2 reads via `fetch('/data/...')` proxied by Vite's `shared-data-proxy` plugin (see `v2/vite.config.js`).
- **Admin writes**: avoid simultaneous admin editing in both versions. v2 admin is read-only until Phase 8 of the rebuild plan.
- **Bug fixes during rebuild**: any fix landing in v1 must also be re-applied to the corresponding v2 destination. Track in `v2/docs/MIGRATION-FROM-V1.md`.
- **Cutover**: single scripted commit via `bash v2/scripts/migrate-v1-to-v2.sh`. Archives v1 to `_archive_v1/`, promotes `v2/*` to repo root. Rollback = `git revert HEAD`.

## Hosting layout — the repo root is the DOMAIN root

`golan.me.uk` hosts more than one project, so **the repo root is not the app** —
it is the domain root, and the app lives one folder down:

```
<repo root>              → golan.me.uk/            hub page, CNAME, 404.html
├── shabi-israel/        → golan.me.uk/shabi-israel/   the whole app
│   └── *.html  css/  js/  assets/  vendor/  table-lab/
├── WC26/                → golan.me.uk/WC26/       predates the layout; keeps
│                                                   its original URL, borrows the
│                                                   app's CSS via ../shabi-israel/
└── gevkahoot/            → golan.me.uk/gevkahoot/   the live quiz (see § GevKahoot)
```

Everything else at the repo root (`scripts/`, `docs/`, `sql/`, `tools/`, `v2/`)
is tooling, not served content.

- **`404.html` at the domain root is the redirect for the old URLs.** The app
  used to be served from the domain root, so `golan.me.uk/league.html?league=…`
  must still land on `/shabi-israel/league.html?league=…`. Pages has no
  server-side rewrites — serving 404.html for every unmatched path is the only
  hook there is. It skips paths already under a served folder, so a genuine miss
  can't loop.

- **Serve locally from the repo root** so the local tree matches production:
  `npx http-server -p 8090 --cors -c-1` → the app is at
  `http://localhost:8090/shabi-israel/`, NOT at the port root. The `tools/*.bat`
  launchers point there — but note the trap they all fell into after the folder
  move: a launcher that PROBES port 8090 and falls back to claiming a free one
  has **two** URLs in it, and only the probe branch got updated. The fallback
  branch still opened the port root, so the launcher worked whenever a server
  happened to be up already and silently opened the domain hub instead of the app
  whenever it did not. When adding or editing a launcher, update every URL in it.
- **Every path inside `shabi-israel/` is relative and must stay that way.** The
  whole folder move worked precisely because the project has zero root-absolute
  (`/…`) paths — a single `src="/css/x.css"` would have broken under the
  subpath and would break the next move too.
- **The only absolute URLs are the `og:`/`twitter:` meta tags**, which the
  protocol requires to be absolute. They carry `/shabi-israel/` and are the one
  thing that does NOT follow a move on its own.
- **Scripts in `scripts/` resolve into `../shabi-israel/`**, not `..`. A new
  script that reads the site must do the same.
- **The build emits page-relative asset paths, never `/assets/build/…`.** A
  root-absolute src resolves against the DOMAIN root and 404s from inside a
  subfolder; `build-v1.cjs` computes the path relative to each page instead.
- A future project = a sibling folder here, plus a link on the hub page. If it
  ever needs its own repo instead, the domain has to move to a
  `<user>.github.io` repo first; `golan.me.uk/shabi-israel/` stays identical
  either way, so no link breaks.

## GevKahoot — the live quiz (`gevkahoot/`)

A second project on the domain, served at `golan.me.uk/gevkahoot/`: a Kahoot-style
live quiz. The host (an allowlisted admin, on a desktop) projects the question;
players join from a phone or a desktop with a temporary name and no account. One
quiz on air at a time. Hebrew, RTL. No build step, same rules as the app (relative
paths only, nothing off-origin) plus a CSP `<meta>` on every page.

| Page | What it is |
|---|---|
| `index.html` | Entry + the player's screen. Shows whether a quiz is on air; `ADMIN LOGIN` is always present on the entry screens. `?demo` plays the demo quiz. |
| `host.html` | The projected screen. After login, the host controls sit on top of it: ☰ (drawer, left — like the app's admin sidebar) and ▶ / Space for "next". |
| `handoff.html` | The goodbye after a LIVE quiz: the Shabi Israel site's own loading screen (its `css/splash.css`, tokens and saved `splash-vars.css`, ring by its `buildRing()`) with the farewell line, filling for 5 seconds, then `location.replace('../shabi-israel/')`. A player's page goes there when the host moves from the podium to the matrix, or takes the finished quiz off the air (`farewell()` in `js/gkPlayer.js`); never in the demo or the preview. A separate page because the site's tokens share names with the quiz's. |
| `editor.html` | The quiz editor — the TOOLS interface (`tools/START_GEVKAHOOT_EDITOR.bat`). Questions, interludes, media, backgrounds, themes, with live previews of both screens. |

- **A player is not a Supabase user.** The whole audience shares the `anon` key,
  so no `gk_*` table a player touches is readable or writable by anon. Every
  player action is a SECURITY DEFINER function keyed by a device token
  (`localStorage['gevkahoot:device']`; the server stores only its sha256). The
  server owns the clock, the correctness check and the score. **The correct
  answers live in `gk_items`, which anon cannot read** — they reach a browser
  only inside `gk_public_state`, written by `_gk_publish()`, and only after the
  reveal. A new feature that needs something on a player's screen adds it to
  `_gk_publish()` for the right phase; it never grants anon a table.
- **Anon reads exactly two single-row tables**, `gk_public_state` and
  `gk_public_live`. Both screens are pure functions of them
  (`js/data/stateSource.js`): Realtime is the fast path, a poll is the safety
  net, and a refresh or a dropped connection resumes from `gk_me()`. A phone
  that lost its token (private tab, another browser) asks to be linked back to
  its name and the host approves it in the drawer.
- **Removing a player ("🗑 הסר" in the drawer, `gk_admin_kick`) removes them
  from the whole quiz**: `kicked`, and every answer of theirs voided, so the
  table, the matrix, the counts and "answered X of Y" all lose them, an action
  round is re-priced without their baskets, and if they were the one still to
  answer the question reveals. Their token is KEPT — it is what tells that
  phone "הוסרת" and refuses it a second join under a new name.
- **Cancelling a question's points** (⊘ beside an asked question in the
  drawer's running order, `gk_admin_cancel(item, true|false)`) is per RUN, not
  an edit of the quiz: `gk_sessions.cancelled` lists the items, and
  `_gk_w(session, item)` gives such an item weight 0. Every place that scores
  or counts a streak reads the weight through `_gk_w` — never
  `gk_items.weight` — so the answers stay and re-price to 0 (`_gk_rescore`),
  the streaks treat it as a ×0 warm-up, and ↺ gives the points back.
- **A taken name is a relink request, automatically.** When a phone joins
  under a name already in the quiz (its owner's browser crashed, most often),
  `gkPlayer.js` sends `gk_request_relink` at once and waits; the host sees it
  ON the screen under ☰ (`.hc-alert`, with whether that player's old device is
  still connected) and approves or rejects without opening the drawer. The
  phone can give up ("זה לא אני") and join under another name — `gk_join` then
  deletes its pending request, so a late approval cannot hand one device two
  players; a rejection reaches the phone as `gk_me().rejected`.
- **Touch and iOS Safari** (`js/ui/touch.js`). `touch-action: none` is not
  always honoured by iOS Safari: the slider would not drag sideways and a
  pinch over the puzzle could not be undone. The slider follows a FINGER with
  touch events (iOS delivers every touchmove to where the touch began; its
  pointer events for a touch stopped part-way and the handle never reached
  the ends on an iPhone 17), a mouse with pointer events. Every drag area (puzzle, slider,
  ranking, court) also goes through `holdTouch()` (a cancelled `touchmove`),
  and while a player is playing the page cannot zoom (`lockZoom`) and is put
  back to scale 1 on each screen (`resetZoom`). A new drag area does the same.
- **Never `letter-spacing` on Hebrew SVG text.** WebKit (every iPhone
  browser) lays spaced SVG `<text>` out glyph by glyph, left to right: the
  jersey's "שאקיל וניל" read "לינו ליקאש" on an iPhone 17 while Chrome showed
  it right. Verified in Playwright's WebKit, the engine to check SVG text in.
- **Too old to play: `gevkahoot/legacy.js`.** The quiz needs a browser from
  2020 on (optional chaining, container units, :has()); an iPhone 5 stops at
  iOS 10.3, whose Safari cannot even parse the modules — the player saw an
  empty page. `legacy.js` is the one ES5 classic script: it shows "the browser
  on this device is too old" when the browser has no modules or a module fails
  to PARSE (a SyntaxError on the window), and gkPlayer.js removes it if the
  quiz starts after all. It sits BESIDE the page, not in `js/`: the build
  deletes `gevkahoot/js` from dist after bundling it.
- **Sound effects go through Web Audio** (`js/ui/sounds.js`): each file
  decoded once, unlocked by the first touch. A new `<audio>` per play was
  silent on an iPhone whenever the play came from a timer (the reveal's
  verdict, a basket) rather than a touch. Three iPhone traps, each met as
  "sometimes the verdict sounds, sometimes not": (1) a context that ran goes
  `interrupted` (locked screen, a notification, another app) — NOT
  `suspended` — so wake it from any non-running state; a sound started into a
  sleeping context is simply lost, so `playSound` waits for the wake-up and,
  failing it, HOLDS the sound up to 6 s for the next touch / return to the
  screen; (2) the gesture listeners must stay for the page's life — only a
  touch wakes it on iOS, more than once; (3) Web Audio follows the silent
  switch unless `navigator.audioSession.type = 'playback'`. `?sounddebug`
  shows, on the device itself, what became of each sound.
- **Host authority is `public.is_admin()`** — the same allowlist as the app. In a
  `gk_admin_*` function it is the first statement.
- **Supabase's default privileges grant EXECUTE on every new public function to
  anon.** `revoke … from public` alone leaves an internal helper callable; the
  grant loop at the bottom of `sql/gevkahoot.sql` revokes from `public, anon,
  authenticated` and grants back by name. A new `_gk_*` helper is covered by
  that loop only once the file is re-run.
- **A `DELETE`/`UPDATE` with no `WHERE` fails when called through the API**
  (pg-safeupdate), even inside a SECURITY DEFINER function — and passes in
  psql, so only the browser finds it. Write `where true`.
- **Going back is free because the table is derived.** The leaderboard is always
  the sum of non-voided `gk_answers`; `gk_admin_goto(k)` voids the answers from
  item k on. Never store a running total.
- **Media are files in the repo**, one folder per kind:
  `gevkahoot/media/{images,videos,audio,backgrounds,sprites}/`. The database
  stores the path and a CHECK refuses anything that is not one (so no off-origin
  URL can be saved). The editor's pickers read `media/manifest.json` —
  **generated, never hand-edit**: after adding, removing OR REPLACING a file
  run `node scripts/gevkahoot-media-manifest.mjs` (`--check` gates it).
  The manifest also holds each file's version (`versions`: sha1 of the
  content, 10 hex digits), and `safeMedia()` puts it in the address
  (`…/x.jpg?v=…`), loading the manifest once by top-level await before any
  screen draws. That is what makes a file replaced under the SAME name show
  up at once everywhere: GitHub Pages lets a browser keep a file ~10 minutes,
  and a host once saw the old picture with the new slot on it. So every
  media address shown on a page goes through `safeMedia()` — a raw path in a
  `src` is the bug. The editor's tools write the version too
  (`addToManifest` in `spriteCutter.js`, same order, same hash).
- **A media file may be named anything a person would name it** — Hebrew,
  spaces, brackets. The first real images dropped into the folder were named in
  Hebrew and, under the original `A-Z a-z 0-9 . _ -` rule, silently never
  appeared in the editor. What a name may NOT contain is what could make it more
  than a name: `/ \ ? # % : * " < > |`, control characters, a leading dot. That
  one rule is written three times and must stay identical: the CHECKs in
  `sql/gevkahoot.sql` §1b, `MEDIA_RE` in `js/ui/dom.js`, `NAME_RE` in the
  manifest script (and the sprite cutter).
- **The bouncing animation** (`js/host/bouncers.js`) belongs to EACH ELEMENT
  (the host's request): a question, an interlude, an "answer explained"
  segment each carry `anim_on / anim_sprite / anim_count / anim_size /
  anim_speed / anim_front` on their `gk_items` row; the quiz's own `anim_*`
  are its OPENING's (lobby, countdown; published as `anim`) and
  `closing_anim_*` its CLOSING's (podium, matrix; published as
  `closing_anim`). The editor shows one checkbox per element — "add an
  animation" — and only when it is ticked the picture and its settings
  (`js/admin/animFields.js`). An element switched on with no picture of its
  own borrows the opening's (the stage's fallback; the demo's items rely on
  it). When the columns first appeared the SQL filled them once so nothing
  on screen changed. New elements start with none. It is drawn BEHIND the question by default — a picture crossing the
  text mid-countdown costs players the question — and never takes clicks. A
  sprite is a transparent PNG in `media/sprites/`, normally made with the
  editor's cutter (`js/admin/spriteCutter.js`): pick a picture already in the repo, draw a free-hand
  outline, and it writes the PNG **and** the updated `manifest.json` straight
  into the working copy through the File System Access API (Chrome/Edge;
  elsewhere it downloads the file). Nothing is uploaded.
  The sprite may instead be a BUILT-IN animation, named not pathed:
  `anim_sprite = 'builtin:gnomes'` — six garden gnomes (`assets/gnomes/<colour>.svg`,
  drawn by `node scripts/gevkahoot-gnomes.mjs`, `--check` gates them), one of
  each colour in turn, every one also spinning on itself; the bounce keeps
  room for its longer side so a turning gnome never leaves the stage. The
  pickers (quiz and per element) list it first (`BUILTIN_ANIMS` in
  `bouncers.js`); the `anim_sprite` path CHECK allows exactly this one name.
  A new built-in = an entry in `BUILTIN_ANIMS` and in that CHECK.
- **The puzzle is a third item kind** (`gk_items.kind = 'puzzle'`), and
  everywhere else it is *a question with one option*: "done" is option 0,
  `correct = '{0}'` by CHECK, so scoring by time, the fastest five, the table,
  the matrix and re-scoring need no special case. The test for "scored item" is
  therefore `kind <> 'interlude'`, never `kind = 'question'` — in SQL and in the
  client alike (`= 'question'` is right only where the OPTIONS are meant).
  `js/host/puzzle.js` cuts any media picture into five pieces with CSS
  (background + clip-path, no image processing), snaps a piece dropped near its
  place exactly into it, and sends "done" BY ITSELF the moment the fifth piece
  is home — there is no button (the host's request: the time is the score, and
  a button cost seconds; `sendPuzzle()` in stage.js, re-sent by sync() if a
  send did not get through). Its instruction slide's demonstration shows real
  jigsaw shapes and "נשלח ✓" appearing on its own. At the
  reveal the picture is shown whole, then everything but the round detail the
  host chose (`circle_x/y/r`, picked on the picture in the editor) fades away
  (the host's choreography: the whole picture stays up LARGE for 3s —
  `SHOW_WHOLE_MS` (10s until the host asked it shortened), scaled UP to fill its area, since a photo of a few hundred
  pixels otherwise stayed that small — then `cutMarks()` shows the cut: the rest
  dims, a line is traced round the detail and scissors run along it),
  and that detail — ONE copy, at exactly the size it had in the picture, at the
  puzzle's own `circle_speed` 1-10 — lifts off and bounces from where it sat
  (`startLift()` in `js/host/stage.js`: a still copy over the picture while it
  fades, then the bouncing layer takes over in the same place and size). It is
  published only at the reveal.
  **"Done" is the one answer taken on trust**: only the browser knows where the
  pieces are. What the server enforces is a two-second floor (`too_fast`), so a
  script cannot claim full marks the instant the puzzle opens; a determined
  cheat can still answer at 2.0s. Do not build a prize on a puzzle's score.
- **"Spot it" is a fourth item kind** (`kind = 'spot'`): the answers are
  rectangles the host draws on a picture (`gk_items.regions`, fractions of the
  picture; up to 12), and a player taps one and confirms. Region N is option N,
  so — like the puzzle — it is an ordinary question to everything downstream.
  The rectangles are published while the question is open (they are the
  choices); `correct` only at the reveal. `js/host/spot.js` draws it; the
  region editor is in `js/admin/itemForm.js`. "How many answers does this item
  offer" is therefore a three-way question — options, regions, or the puzzle's
  one — answered in one place per layer: `v_n` / the bound check in
  `gk_answer` (SQL), `choices()` in `js/demo/engine.js`.
- **The "answer explained" segment** (`kind = 'explain'`) is an interlude that
  BELONGS to a question: its own row (so it has its own text, media, music and
  animation), tied by `parent_id`, at most one per question, deleted with it. It
  is **not a stop in the running order** — `_gk_ordered()` and every item count
  skip rows with a parent — so "next" after a reveal goes reveal → explain →
  fastest → table. While it shows, `item` in the published state stays the
  question (a phone still knows what it answered) and the segment rides beside
  it as `data.explain`; the stage draws it as an interlude. In the editor it is
  `item.explain` on its question, never an entry of `items` — look an id up
  with `everyItem()`.
- **Per-element playback is three states in two columns.** `music_on` /
  `anim_on = false` mean "none here"; `music` / `anim_sprite` hold "this file
  here"; both empty means "as the quiz". The stage resolves it for the element
  on screen (`current()` — the segment during `explain`, else the item). The
  quiz's `anim` object is always published, with `on`: an item may bring its
  own sprite to a quiz whose animation is off and still needs the quiz's count,
  size and speed.
- **A tile's mark may be an emoji** (`gk_items.symbols`, one per answer, `''` =
  the default emblem). The tile's COLOUR never changes — "red is the first
  answer" holds either way.
- **A question (and a ranking) picks a mark set** (`gk_items.marks`): `teams`
  (default), `emoji` (the per-answer `symbols` above), `catan` (terrain hexes
  with the resource's picture), `circuit` (resistor, inductor, capacitor,
  battery, diode), `cards` (joker, ace of spades, queen of hearts, eight of
  diamonds, two of clubs — suits drawn as paths, not font glyphs, which look
  different on every phone) or `fruits` (kiwi on red, red grapefruit on blue,
  watermelon on yellow, peach on black, melon on purple — the asked order
  would have put the red grapefruit on the red tile). An image set is `assets/<set>/<colour>.svg` — five files
  named by TILE colour, chosen for contrast (never a picture on a tile of its
  own colour); `crest()` in `js/ui/teams.js` is the one place that resolves it.
  An emoji in `symbols` wins whatever the set, so rows saved before the column
  still show theirs. The catan/circuit/cards SVGs are drawn from scratch by
  `node scripts/gevkahoot-marks.mjs` (`--check` gates them) — **generated,
  never hand-edit**; their lift off the tile is the shared `.gk-crest img`
  filter, not baked into the files. A new set = a draw function there, a
  folder, an entry in `MARK_SETS`/`IMAGE_SETS` and in the SQL CHECK.
- **`dir="auto"` flips more than letter order.** It makes the element's own
  inline-start/end follow its content, so `text-align: start`,
  `padding-inline-end` and `inset-inline-end` all switch sides for a value like
  "3" or "Guy". Twice this put text where it could not be read (English names
  on the far side of the table; an answer hidden under the emoji button). On a
  `dir="auto"` element use physical `left`/`right` and `text-align: right`.
- **"Complete the picture" is a fifth scored kind** (`kind = 'complete'`): a
  picture with one object taken out, and 2-5 candidate pieces. Tapping a
  candidate draws it into the gap on the picture itself, so the player judges by
  eye and can swap freely before submitting. Candidate N is option N. Here
  `options` holds OBJECTS (`{image, scale}` — a cut-out in `media/sprites/` and
  its width relative to the real object, 1 = exact), not strings, and `slot` is
  where the object was. A path inside that JSON gets the same "file name inside
  its folder" rule as a media column, via `jsonb_path_exists` in the CHECK.
  The editor makes one from any picture (`js/admin/completeMaker.js`): a
  free-hand outline, then `removeObject()` writes the picture without the object
  (to `media/images/`) and the cut-out (to `media/sprites/`). The removal is a
  simple inpaint — fill inwards from the rim, relax, add grain: clean on plain
  backgrounds (sky, grass, a wall), a soft blur over busy ones. Fine for the
  game — the gap is marked on screen anyway — but do not promise "invisible".
  Every editor tool that writes media goes through `saveMediaFile()`
  (`js/admin/spriteCutter.js`), which also updates the manifest.
  **All media is pushed media.** The host chose this outright: no upload to
  Supabase Storage, no file from the computer. So the cutting tools (sprite
  cutter, complete-the-picture, slider) take their SOURCE picture from the
  repo — `repoImagePicker(manifest, …)`, images/ and backgrounds/ from the
  manifest — and never an `<input type="file">`; what they make is written
  back into `media/` as a new file beside the original, to be committed and
  pushed like any other. A new tool that needs a picture does the same.
- **The slider is a sixth scored kind** (`kind = 'slider'`) and the one that is
  NOT right-or-wrong. Same cut-out as "complete the picture" (one piece in
  `options`, `slot`, made by `completeMaker.js`), drawn at its own place; the
  player sets its SIZE with a slider and the answer is the POSITION, 0-1000, in
  `option_idx`. The object's SIZE — its perimeter, NOT its area (the host's
  request; deviations and points are measured on it too, so 10% off is 10% of
  the outline) — grows linearly from `slider_min` of the real size at 0 to the
  real size at the target `correct[0]` — BOTH the author's, per question
  (defaults 0.577 and 700; CHECK: min 0.05-0.95, target 100-1000; the SQL
  converted the earlier area shares to sizes once, √, marked by the column's
  comment 'size'), set in the editor with a live try-out of the player's own slider
  on the question's picture. Published as `item.slider = {min, target}`
  (the slider must draw the sizes; the gap on screen gave the target away to
  a script anyway). Every slider function takes that scale (`sliderScale()`
  in js/scoring.js, `_gk_slider_dev(v, target, min)` and `_gk_score(…,
  slider_min)` in SQL). `correct` means "target position", not an option index. Points = time points × max(0, 1 − |area deviation|)
  (a 100% deviation would score 0; the slider's worst is −67%, its far end +29%). In the matrix
  a slider cell is NOT right/wrong: it carries `[ok, ms, points, deviation]`
  (`_gk_matrix` adds the last two, deviation only for a slider) and is
  coloured linearly red → green by that same factor, with the seconds and the
  deviation in it. "correct" = within 5%, used only for the fastest five and
  the table's tie-break. Scoring lives in ONE SQL
  function, `_gk_score()` (used by `gk_answer` AND the re-score), mirrored by
  `js/scoring.js` (the demo, and the deviation a phone shows after the
  reveal) — verified equal value by value; change both or neither. At the
  reveal `_gk_publish` adds `values` (every position chosen) instead of
  `counts`. "Submit" appears only after the first move (default 50%), and a
  slider moved but never submitted is sent where it stands just before the
  bell (the host's rule: when time is up, the slider's place IS the answer);
  an untouched one stays unanswered. An
  optional emoji (`symbols[0]`) rides the handle, scaled like the object.
  The target was 90% (900) until the host moved it to 70%: at 90% the far
  end (1000) was only 7.4% too big and earned ~93% of the points; at 70% it is
  28.6% too big and earns ~71%. The SQL file moves existing sliders' `correct`
  from '{900}' to '{700}' before re-adding the CHECK.
- **The ranking is a seventh scored kind** (`kind = 'rank'`): 2-5 answers
  dragged into order by a keyword the host sets (`body`: "מוקדם", "גדול" — most
  at the top). `correct` is the right ORDER (option indexes, top place first;
  CHECK: a full permutation), and the answer is the whole order packed into
  `option_idx` as base-5 digits, top place in the lowest (`_gk_rank_order` in
  SQL, `encodeRank`/`decodeRank` in `js/scoring.js`). Only the exact order
  scores; the reveal publishes `right` (how many got it exact) instead of
  `counts`. **The options are stored scrambled** — the stored order is what a
  player first sees — so the editor shows the list in its right order and
  `scrambleRank()` saves it by a hash of the text (not alphabetical: for
  years or numbers that IS the answer), rotating it if the scramble happens
  to be the answer. Unlike every colour question, the answer's TEXT is on the
  card on a phone too — the words are what is being ordered. Cards are
  absolutely placed in equal slots (`js/host/rank.js`), so a reorder is one
  `top` assignment the transition animates. That is how the reveal shows the
  RIGHT order (the host's request): a phone first shows the player's own order
  with ✓/✕ per place, then after 1.8s the cards slide into the right order
  under "✓ הסדר הנכון", each misplaced card saying "אצלך: מקום N"; the
  projected screen goes straight to the right order with the same heading.
- **The memory question is an eighth scored kind** (`kind = 'memory'`): a
  picture held up for `memo_s` seconds (3-120), then taken away, and only then
  the question — 2-5 typed answers on tiles, scored exactly like a `question`
  (it takes a mark set too). The memorising time IS the lead-in:
  `_gk_start_question` puts `q_started_at` `memo_s` ahead, so `gk_answer`
  refuses an answer while the picture is up ('closed') and the time points
  count from when it goes. It opens on a WARNING slide (phase `intro`, the
  host's request — it used to start cold): "משחק זיכרון!", how many seconds
  the picture will be up, and a generic scene being covered; "next" then
  holds the picture up. The title is NOT shown while
  the picture is up — it would say what to look at. At the reveal the picture
  returns with `arrows` (`[{x1,y1,x2,y2}]`, tail → tip as fractions of the
  picture, up to 12, any number) — published only then, since they point at
  the answer. `js/host/memory.js` draws them for the stage and the editor
  alike, in an SVG laid over the picture's own box with a viewBox in its
  natural size (a 0-1 viewBox would squash the heads on a wide picture). The
  editor draws an arrow by dragging from its tail to the thing. On the reveal
  the picture takes the larger half of the screen (`.st-item[data-memory]`).
  Known property: a player can photograph the screen while the picture is up.
- **The action round is an eighth scored kind** (`kind = 'action'`, "🏀
  קליעות"): free throws on a drawn court for the whole time limit (10-120s,
  CHECK; 30 by default). The ball is a round detail of a picture — `image` +
  `circle_x/y/r`, which a new action item copies from the nearest puzzle
  before it, so the circle that just lifted off the puzzle comes back as the
  ball (published as `item.ball`; none = a drawn basketball), held up between
  the hands of a drawn shooter seen from behind (`shooter()`: Shaquille
  O'Neal in Orlando's pinstripes, 32; arms up on the follow-through via
  `data-shot`) — drawn IN FRONT of the ball's layer, so his hands grip it and
  a short throw falls behind him. A throw is a drag towards the
  hoop: its sideways slope is the aim, its length the power, its duration
  whether it was a throw — the three windows are `THROW` in `js/scoring.js`,
  scaled per question by the host's difficulty (`gk_items.throw_level`, 1-10,
  5 = `THROW` exactly; `throwWindows(level)` widens/narrows aim and power
  together by 2^((5 − level)/4); the demonstration hand keeps level 5),
  judged by `judgeThrow()` in `js/host/action.js`; the ball flies where that
  sends it, a mark stays where it came down, and the message is one of the
  AUTHOR's lines (`gk_items.feedback = {hit: [..], miss: [..]}`, written in
  the editor, one picked at random per throw, never the same twice running;
  up to 12 of each, one line of 1-80 characters, by CHECK) with the built-in
  diagnosis under it ("חזק מדי", "קצת שמאלה מדי"; alone when there are no
  lines). When the time is up a buzzer sounds — on the projected screen AND
  on every player's device (it is everyone's bell), once per round and only
  right at the bell, never on a screen that opens on a finished round:
  `assets/sounds/buzzer.wav`, synthesised by `node scripts/gevkahoot-sounds.mjs`
  (`--check`) — an app sound, so under assets/, not media/. A basket plays
  the quiz's fixed "correct" sound and a miss its "wrong" (below).
  The answer is the RUNNING COUNT of baskets, re-sent after every throw: for
  this kind `gk_answer` updates the one row upwards instead of refusing a
  second answer, never auto-reveals ("everyone answered" is true after the
  first throw), and holds the count to one basket per second of clock — the
  count is the browser's word, like the puzzle's "done". Points are
  RELATIVE: linear from the room's fewest baskets (0, as if wrong) to its
  most (weight × 1000, as if answered at once) — `_gk_action_factor` /
  `_gk_action_score`, re-run after every throw and by the re-score, mirrored
  by `actionFactor()`. "Correct" = a share above 0. The reveal publishes
  `values` (every count); the fastest five are its five best shooters
  (`hits`); a matrix cell is `[ok, ms, points, null, hits, share]`, coloured
  on the slider's red → green scale by `share`. The projected screen and the
  instruction slide show the court with a hand throwing by itself (`auto`).
  A player's count lives in the stage (`throws`), so a rebuilt screen
  carries on from it.
- **Three background musics, by the host's rules** (`syncMusic()` in stage.js,
  re-decided on every clock tick because it follows the clock):
  `lobby_music` in the lobby and the "starting in…" slide; `music` (what an
  item's "כמו בחידון" means; an item's own file beats it) under an interlude,
  and under a question ONLY while it can be answered — from the clock's start
  to its end: not the get-ready count, not a memory picture, not an
  instruction slide. A plain multiple-choice question ('question', 'memory')
  stops at the bell; the SPECIAL kinds (picture games, roulette, action) play
  on through their reveal. `podium_music` on the podium and the matrix. Never
  under the fastest five, the special slide or the table; an "answer
  explained" segment plays only a music of its own.
- **Music per slide** (`slide_music` jsonb on `gk_items` and on `gk_quizzes`,
  the host's request): every screen of a question — intro, ready, question,
  reveal, fastest, fire, leaderboard — and of the quiz's opening (lobby,
  countdown) and closing (podium, matrix) may override the rules above: a
  missing key = the rules; `'none'`; `'continue'` (syncMusic leaves whatever is
  playing alone); or a file in media/audio/ (plays even where the element's
  own music switch is off). CHECKed (known keys only, string values only, a
  path only inside media/audio/); published with the item and in
  `_gk_quiz_json`; picked in the editor by `js/admin/slideMusic.js` — inside
  the item form (saved by its Save button) and in the opening / closing
  panels (saved at once, like every quiz setting).
- **The editor's layout.** A side menu, the window's full height, folding to a
  strip (open by default, remembered): the running order between two
  bookends — "פתיחה" (the quiz's settings, animation, lobby and countdown
  slides) and "סיום" (winners' music, podium, matrix). Selecting anything
  shows its slides in the previews, stepped through with ‹ › and dots (a
  question opens on itself; the last question adds the leader slide); a
  slide's name in a music row jumps the previews to it.
- **"Starting in 7… get ready"** (phase `countdown`, the host's request): the
  host's first "next" from the lobby shows it (`ends_at` = `q_deadline`, 7s);
  the HOST's screen calls `gk_admin_countdown_done()` when it runs out — which
  steps on only while the countdown is still showing, so two host tabs cannot
  step twice; a "next" sooner skips it. Mirrored by the demo engine and the
  preview (`countdown` view). Its classes are `st-cd-*`: `.st-count` is the
  lobby's player counter, and sharing it blew the slide up. `music_on`
  switches both. When the column was added, existing quizzes got their one
  music copied into it, so no lobby went quiet. Published in `_gk_quiz_json`
  and mirrored by the demo engine and the mock; chosen in `syncMusic()`.
- **Who hears what.** The ROOM's sound — background music, a video's
  soundtrack, an audio clip — plays only where `media` is `'full'` (the
  projected screen; the demo): a phone shows the picture, a desktop player
  mutes it. Three fixed sounds, not settings, in `js/ui/sounds.js`
  (`media/audio/Correct.mp3`, `Wrong.mp3`, `Applause.mp3` — the host's own
  files; renaming one silences it — plus the buzzer): CORRECT / WRONG are a
  player's OWN verdict on their own device, any kind (the roulette
  included) from `me.result.correct` at the reveal — once per question, only
  on a screen that saw it open (a refresh onto a reveal is silent), nothing
  for no answer — and in the action round on every basket / miss instead;
  APPLAUSE greets the podium where the room's sound plays, and on the
  winner's own device; the buzzer is everyone's. The preview is silent.
  The ROULETTE's verdict waits for the ball: `answerSound` returns while
  `spinFor` is the item and the wheel's `showTable()` calls it again when the
  ball lands — and a winning number then pays out: `moneyRain()` (js/ui/views.js),
  banknotes drawn on a canvas bursting over that player's screen.
- **The winner's moment** (the host's request). On every screen, as first
  place lands on the podium, gold rays turn behind its column and the name
  glows (css/base.css). On the WINNER's own device — `me.rank === 1` at the
  finished podium, never in the preview — `winnerMoment()` covers the screen
  ~3.3s in: a trophy, "ניצחת!", their name, place and points, confetti and
  applause; a tap or 7.5s closes it. `crowned` makes it once per quiz (reset
  when a new quiz starts, so the demo's "play again" crowns again).
- **The roulette is a scored kind** (`kind = 'roulette'`): a single-zero
  betting table, 0-36; a player taps a number (a chip lands on it, carrying
  the number so the bet still reads) and submits. The number IS the option
  index, so it is an ordinary question with 37 options and exactly one right
  (CHECK `gk_items_roulette_shape`; `v_n` and the `gk_answer` bound are 37).
  At the reveal the wheel spins (`createWheel`, `js/host/roulette.js`, a drawn
  SVG — the reference Lottie was inspiration only, nothing is loaded from it)
  and the ball drops into that number; then the table, the winning square lit
  and each square's chip count on it. The spin is a pure function of time
  since this screen first saw the reveal (`spinStarts` in `stage.js`), and its
  start angles come from the item id — so a rebuilt screen joins it mid-way
  and every screen shows the same spin. The table is `direction: ltr` whatever
  the page (0 on the left, as on a real table): 12 × 3 on the projector, 6 × 6
  under a full-width zero on a phone. No instruction slide.
  **A player's result waits for the ball**: while the wheel turns, the
  stage's `spinning` is true, the phone's status line says "הכדור מתגלגל…"
  and its score pill shows the total WITHOUT this question's points; the
  stage's `onSettled` re-renders them when the ball lands. Any new place that
  shows a result must honour `stage.spinning` too.
- **Streaks, and the quiz's one special slide.** A streak is a run of correct
  answers (display only, no bonus), counted over scored items worth something:
  a ×0 warm-up neither extends nor breaks a run, an unanswered question breaks
  it. Derived from the answers (`_gk_runs` → `_gk_streaks`), so going back
  recomputes it. A run of 3+ shows as 🔥N beside the name in the table
  (`streaks`) and on the player's own line (`streak` in `gk_me`). There is no
  per-question "ON FIRE" slide — the user asked for exactly ONE special slide
  per quiz (phase `fire`, `media/animations/first-streak.svg`): at the first
  question where anyone reaches three (`fire.first`; several at once → most
  points over those three answers), between the fastest five and the table;
  or, if nobody has had three by the time the last question comes up, before
  it, for the leader (`fire.lead`: name, gap to second, 0 = tie). So `fire`
  is reached from `fastest` (the streak case) or from the step INTO the last
  question (the leader case — `gk_admin_next` tells them apart by whether
  `_gk_fire` is null). The words are laid out in a band ABOVE the animation,
  never over it: the animation fills its whole 16:9 picture (the logo sits at
  its top), so a name laid on top covered the logo. The animation is one
  self-contained SVG (both pictures embedded as WebP: an SVG shown as an
  `<img>` loads nothing else); its hand-drawn horse's legs pivot on px points
  in the horse's own drawing — keep `transform-box: fill-box` OFF those parts,
  or each leg swings around its own middle and flies off. The demo engine
  mirrors all of it. Verify with `node scripts/gevkahoot-streak-check.mjs`.
- **The fill behind a removed object** (`removeObject()`) covers the outline
  enlarged 1.5× about its centre (the edge, the shadow, and room for the
  slider's smaller sizes), as a smooth colour layer plus REAL texture: tiles
  of fine detail shifted in from the nearest patch outside the hole, blended
  between tiles, capped so strong edges are not copied. Copying detail per
  PIXEL by mirroring across the rim was tried first and drew radial streaks.
- **Never put a backslash-heavy literal through a shell heredoc.** A regex
  written into a file by `python - <<EOF` had its `\u0000-\u001f` turned into
  the real control characters: it still parsed and still matched, and the file
  became "binary" to grep. Write such a line with the Write/Edit tools, or from
  a script FILE, and scan for control characters after any generated edit.
- **The picture games open on an instruction slide** (phase `intro`): puzzle, slider, ranking,
  spot it, complete the picture and the action round are not self-explanatory (and the memory
  question needs its warning), so `_gk_enter()`
  puts them on a slide with a looping demonstration and two steps, with NO
  clock. The question and its countdown start only on the host's "next"
  (`_gk_start_question()` — the one place `q_started_at` / `q_deadline` are
  set). The demonstrations (`js/host/intro.js`, `.dm-…` in `host.css`) are plain
  boxes on CSS keyframes — generic shapes, never the question's own picture,
  which must not be given away before the clock runs. (The one exception
  is the action round's: its slide throws the real ball, because that ball
  is the circle the puzzle before it already showed — seeing it again IS the
  introduction.) Two traps met building
  them: an `em` on an animated element is ITS OWN font-size (the hand, enlarged
  with `font-size: 2em`, travelled twice as far as intended — enlarge an inner
  element instead); and a property named in only the LAST keyframe is animated
  towards it from 0% (a piece meant to vanish at the end faded all the way) —
  state it in the keyframe before as well.
- **The quiz object a screen receives is built in ONE place**,
  `_gk_quiz_json()` — used both while the quiz runs and when it is frozen into
  the archive. It had been hand-copied in two functions; a field added to one
  would have vanished from finished quizzes. A new quiz-level setting goes
  there, and in the two client mirrors (`js/demo/engine.js`,
  `js/preview/mock.js`).
- **One stage, three audiences.** `js/host/stage.js` draws the quiz for the
  projected screen AND for every player (`gkPlayer.js` embeds it and adds one
  status line underneath). Options, not forks: `role: 'player'` makes the
  answers buttons; `compact` (touch, or narrower than 760px) is the phone
  layout — the question and its picture are shown, **the option texts are
  not**, only colour and emblem; `media` is `'full'` on the projected screen
  and in the demo, `'muted'` for a desktop player and `'still'` for a phone in
  a live quiz, because the room already has the sound. The stage is sized in
  container units of its frame (`.st-frame`), never `vw`/`vh` — that is what
  lets the same CSS serve a projector, an embedded player and the editor's
  scaled preview. A change to how a question looks is made once, here.
- **A saved quiz can be played ALONE** (`index.html?demo&quiz=<id>`): the same
  quiz the host runs live, against the demo's bots (the host's request). The
  engine takes its content as an argument (`createDemo(onChange, { quiz,
  items })`), and `js/demo/saved.js` fetches it with `gk_demo_get` and adds
  what a live run gets from the host or `_gk_publish` (an interlude's
  `seconds`, the puzzle's `circle`, the action round's `ball`). That hands the
  CORRECT ANSWERS to an anonymous browser, so it is opt-in per quiz
  (`gk_quizzes.demo_public`, the editor's "זמין כחידון לדוגמה", which says
  what it costs) and refused while that quiz has a lobby or running session —
  a phone in the room must never fetch the answers mid-quiz. The entry screens
  list the opened quizzes (`gk_demo_list`). Known property: someone who plays
  it alone BEFORE the live run knows the questions; switch it on after.
- **The demo (`index.html?demo`) is a whole quiz with no backend.**
  `js/demo/engine.js` plays the host and eleven bots on a timer and emits state
  in exactly the shape `_gk_publish()` / `gk_me()` produce, so it runs the real
  rendering code — when that shape changes, the engine and
  `js/preview/mock.js` change with it. Its content is `js/demo/demoQuiz.js`,
  mirrored by `sql/gevkahoot_demo_seed.sql`; its video and audio are synthetic,
  regenerated by `node scripts/gevkahoot-demo-media.mjs` (two questions ask about
  them — "how many balls", "how many beeps"). It is meant to show EVERY
  capability (each scored kind, an explain segment, interludes before and
  after questions in each media kind and layout, emoji everywhere, per-element
  overrides) — a new feature gets a place in it, in both files. Once the
  real player has answered, the engine records the bots' already-decided
  answers at their planned times and reveals at once: nobody real is left to
  wait for. The points formula exists twice
  for this reason only: `_gk_points` in SQL is the authority, `js/scoring.js`
  is the demo's copy.
- **CSS animations do not advance in an occluded Playwright MCP window.** An
  element measured "mid-entrance" seconds after it appeared (a podium column
  40% low, a ×2 marker four times its size) is the frozen first frame, not a
  layout bug — check `getAnimations()[0].currentTime` before chasing it.
- **An item is saved only by its Save button** (`js/admin/itemForm.js`, in
  the editor and in the host's drawer alike) — there was an autosave, and
  the host asked for it to go: a fix to a live question reaches the air only
  when they press Save. The trap that came with it: both places REBUILD the
  form often (the editor after every action, the drawer every 2.5s), which
  with autosave cost nothing and without it silently drops a draft. So the
  form is mounted through `keptForm(key, build)` — a form with unsaved
  changes comes back as the same element — and every move away from it
  (another item, another quiz, a new item, the drawer's ✎) first asks
  `leaveForms()`, which confirms. A new place that hosts the form must do
  both.
- **The editor previews are the real pages**, framed with `?preview` and fed
  invented state by `postMessage` (`js/preview/mock.js`). That state carries
  `frozen_at`, and the stage's clock stands still at it: a question shown in
  the preview never runs out (it used to lock after its time limit — the
  preview's slider "would not reach the ends" because it was simply locked). A screen that must be
  previewable therefore renders only from the state object — no fetch of its own.
- **All DOM goes through `h()` in `js/ui/dom.js`** — text nodes only, no
  `innerHTML` anywhere in `gevkahoot/`. Names and question text are strangers'
  input shown on a projector.
- **Tile N is always option N**: red, blue, yellow, black, purple
  (`js/ui/teams.js`; artwork in `assets/teams/<colour>.svg`). Themes restyle the
  stage, never the tiles.
- **Verify** (local Docker Supabase; both refuse to touch a quiz that is really
  live, and neither can reach production):
  `node scripts/gevkahoot-security-check.mjs` — what a player's browser cannot do,
  each refusal paired with a control;
  `node scripts/gevkahoot-sim.mjs` — a whole quiz with 30 simulated phones,
  including going back and a device relink.
- **Load: `node scripts/gevkahoot-load.mjs --password-file <file>`** — a short
  real quiz (question, basketball, two questions, seconds each) played by
  twenty REAL browsers at once: Chrome and Edge as Android phones and on the
  desktop, WebKit as iPhones, Firefox as an Android phone — each joining
  through the form, tapping and throwing with a real pointer. Reports, per
  browser family, how long after each host step the screen changed, tap →
  "נקלט" and throw → feedback (timed inside the page), every server call's
  p50/p95, and console errors. `--target cloud --yes` runs it against
  golan.me.uk (refuses while a quiz is on air; aborts and deletes its quiz, so
  nothing enters the archive). The host password is read from a file outside
  the repo, never from the command line. Measured on one machine, the
  browsers compete with Docker for CPU: compare runs from the same place.
- **`node scripts/gevkahoot-layout-check.mjs` after ANY change to a GevKahoot
  screen** (needs the dev server on :8090, no login, no database). It asks of
  every stage of a quiz, for the projected screen, a desktop player and a phone
  player, at ten window shapes: is any text or picture cut by a clipping
  ancestor, or a label truncated to almost nothing. "Nothing leaves the
  viewport" is NOT that question — the leaderboard shipped with names squeezed
  to zero and points off the edge while passing it, because the text was cut by
  its own row, inside the viewport, in a window taller than the one tested.
  Sizing type from a container's HEIGHT alone is what did it; bound it by the
  width too (`min(<from height>, <n>cqw)`).
- SQL: `sql/gevkahoot.sql` (re-runnable; after `admin_write_allowlist_2026-10-09.sql`),
  optional `sql/gevkahoot_demo_seed.sql`.

## Data & query standards

v1's read path moved from static CSV/JSON to Supabase (see `js/data/supabaseLoader.js`). A ground-up redesign of the query strategy is proposed in `docs/data-architecture/` — read `docs/data-architecture/README.md` first. Once approved and implemented, all future pages/features touching data reads must follow `docs/data-architecture/02-query-standards.md`.

### There IS a player registry — use it

A league is an entity (`public.leagues`: a row, able to exist before its first
fixture). **A player is not** — a person exists only by appearing in a match's
`player_a`/`player_b`, and `players_metadata` is decoration on an
already-existing player (a handful of rows against the full roster), not the
roster. `public.players_registry` (`sql/players_registry.sql`) is the missing
definition, written once and carried inside `get_site_bundle` — so reading it
costs **no extra round trip**.

- **Browser:** `loadVisiblePlayerNames()` in `js/data/store.js`.
- **Database:** the view directly (`public.mail_orphan_reason` is the worked
  example), so the server and the browser cannot disagree about who exists.
- **Never rebuild it** with `for (const l of leagues) for (const p of l.allPlayers)`.

**Scope, not habit.** Ask the registry when the question is about the player *in
the system* — may this name appear in a cross-league search, does it exist, are
they playing now. Do NOT ask it for a *context's* roster: an in-league picker
offers that league's players, a round view that round's, and admin autocomplete
deliberately also offers staged and pre-registered players the registry has
never heard of. **The test: if the list should look identical on every page it
comes from the registry; if it changes with the page, it does not.**

Why this is a standing rule and not a preference: the definition used to live in
**five** places, each written separately. They disagreed — the Players tab
counted any league, the mail-report check counted only running ones — and a
player of five seasons was reported to the admin as `Unknown player: fridlich`.
A drifted copy never fails loudly; it returns a plausible list, and the
disagreement surfaces somewhere else entirely looking like a data problem.

**Verify with `node scripts/check-players-registry.mjs`** — it fails with exit 1
and lists every offending file:line. Run it after touching anything that builds
a list of players.

## Project Overview

Shabi Israel is a Backgammon league statistics web app. It loads CSV match data client-side, computes player statistics (win rate, PR, luck, rankings), and renders interactive HTML pages with sortable tables and color-coded stats.

No build step — pure vanilla HTML/CSS/JS running in the browser. Deployed on GitHub Pages. (v2 introduces Vite; deployment workflow updates at cutover.)

## Architecture

3 HTML pages with SPA-like navigation via query params:
- `index.html` — Landing page listing all leagues
- `league_table.html?league=<id>` — League summary with ranked player table
- `player_league.html?league=<id>&player=<name>` — Player match history

### JS Modules (`js/`)
| Layer | Files | Purpose |
|-------|-------|---------|
| Data | `data/csvParser.js`, `data/leagueLoader.js` | Parse CSV, fetch league data |
| Compute | `compute/stats.js`, `compute/rankings.js`, `compute/colorScale.js`, `compute/leagueTypes.js` | Statistics, sorting/ranking, color gradients, league type config |
| Render | `render/landingPage.js`, `render/leaguePage.js`, `render/playerPage.js` | DOM rendering for each page |
| Utils | `utils/helpers.js` | URL params, formatting, flag paths |

### CSS (`css/`)
- `variables.css` — Design tokens (colors, spacing, fonts)
- `layout.css` — Page structure, responsive breakpoints
- `components.css` — Tables, badges, medals, flags, status pills
- `theme.css` — Data-driven color classes

### Data (`leagues/`)
- `landing_settings.json` — Title, subtitle, logo path, and display order of leagues (source of truth for league discovery)
- Each league folder contains `leaguedata.csv` and `league_params.json`

## Development

Serve locally (ES modules require a server) **from the repo root** — the app is then at `http://localhost:8090/shabi-israel/`, matching production (see § Hosting layout). **Preferred port: 8090** (we standardised off 8080 because other tools collide on it), but don't fixate on it — see below.

### Dev server — reuse if already up, else claim the next free port

The `http-server` process is OS-level, independent of any Claude window. If a sibling window already started one on 8090, every other window should reuse it. Before starting a server, always probe:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/shabi-israel/index.html
```

- `200` → server is up, reuse `http://localhost:8090/shabi-israel/` as-is. Do **not** relaunch.
- anything else → try to start it on 8090; if that port is already held by something that isn't this app (EADDRINUSE, or a 200 comes back but not from this app's index.html), walk up sequentially (8091, 8092, …) until one binds cleanly:
  ```bash
  npx http-server -p 8090 --cors -c-1
  ```
  Run with `run_in_background: true` so it survives the turn. A follow-up 200 probe on the chosen port confirms bind success even if the bash task reports a non-zero exit.

Never kill a running `http-server` just to "start clean" — other windows (and the user's own browser tabs) may depend on it. This reuse-or-increment pattern applies to every project, not just this one.

### Playwright MCP — isolated per session (parallel-safe)

`.mcp.json` passes `--isolated` to the Playwright MCP server, so each Claude window gets its own in-memory browser profile instead of sharing one Chrome profile. This means multiple windows/sessions can drive Playwright MCP at the same time without the old "Browser is already in use" lock.

Trade-off: an isolated profile does **not** persist logins/cookies across sessions — each session starts logged out. For BGStudio automation, log in fresh each session (see `reference_mcp_credentials` memory for the test account) rather than expecting a shared authenticated session.

### Playwright MCP — two servers: `playwright` (desktop) and `playwright-mobile`

Mobile behaviour on this site is gated on **touch, not width**
(`isTouchDevice()` in `js/render/searchOverlay.js` reads `pointer: coarse` /
`maxTouchPoints` / `ontouchstart`). So `browser_resize` to 390px does **not**
put the site in mobile mode — it gives you a narrow desktop, and every
touch-only path (the search sheet above all) stays dormant. This has already
caused a "the sheet is broken" false alarm.

`.mcp.json` therefore declares a second server, `playwright-mobile`, started
with `--device "iPhone 15 Pro Max"` (430×739, dsf 3, `hasTouch`) — 430px
matching the real phone this project is checked on. Use its `browser_*` tools
for any mobile verification; use plain `playwright` for desktop. Both carry
`--isolated`, so they run side by side.

**Do NOT emulate touch over CDP** (`Emulation.setTouchEmulationEnabled` /
`setEmitTouchEventsForMouse` via `browser_run_code_unsafe`). It sets the
signals the page reads, so it looks like it worked — and then **every**
`click()` in that context times out at "performing click action", including on
elements with no relation to touch, because Playwright's input pipeline and the
CDP override disagree about the event model. The damage outlives
`clearDeviceMetricsOverride`; only closing the page clears it. `hasTouch` has to
come from the browser context at creation, which is what `--device` does.

**A window is mobile or desktop for its whole life.** Pick the server before the
first navigation and stay on it; there is no way to convert a running window.

`?searchoverlay=force` / `=off` is a **per-URL** override, not a session mode: it
applies to the page you load it on and is LOST on the next navigation, so a
session run that way silently drops back to desktop the moment you follow a link
to the next search. Use it for a one-off check of the opposite mode on either
server — never as the way to test mobile.

### Automated browsing must never reach the live analytics

Driving a real browser against `golan.me.uk` fires **real analytics beacons**.
A single performance run once wrote **151 pageviews across 103 sessions into one
hour** of the production dashboard — each measurement uses a fresh browser
profile, so each registered as its own visitor. Cleaning it up needed a
hand-written SQL file reconstructed from timestamps
(`sql/cleanup_test_analytics_2026-08-18.sql`), because the traffic had left no
marker to filter on.

- **Playwright scripts:** set the flag in `context.addInitScript()`, before the
  first navigation —
  `try { localStorage.setItem('shabi:no-analytics', '1'); } catch {}`
- **MCP / hand-driven browsing:** load the FIRST url with `?notrack`. It writes
  the same localStorage key, so it survives every navigation after it — a
  per-URL override alone would cover exactly one pageview, the same trap as
  `?searchoverlay=force`. `?track` clears it.
- `analytics.html` emits nothing (it does not load `js/analytics.js`), so
  reading the dashboard is always free.
- **Verify with `node scripts/check-no-analytics-pollution.mjs`** (fails if a
  browser-driving script under `scripts/` forgot the flag) and
  **`node scripts/perf/verify-analytics-optout.mjs`** (proves `js/analytics.js`
  still honours it, with a control case so a silent no-op cannot pass). The
  second refuses to run against production.

### Playwright MCP — output directory (NEVER write to repo root)

Playwright MCP is configured in `.mcp.json` to write all artifacts (screenshots, traces, sessions) into `.playwright-mcp/`, which is gitignored. **Never** save MCP-generated files at the repo root — and never pass an absolute path or a bare filename like `"foo.png"` to `browser_take_screenshot` that would land in the project root. If you need a tracked screenshot (e.g. for a design audit), explicitly write it under `docs/audit-*/screenshots/`. Repo root has a blanket `/*.png /*.jpg /*.jpeg /*.gif /*.webp` ignore rule — even an accidental drop won't be committed, but it also won't appear in `git status`, so be deliberate.

No build, no dependencies, no package.json. All JS uses ES modules (`type="module"`).

## No third-party resources — project-wide rule

**No page may load anything from an origin we don't own.** No Google Fonts, no
CDN scripts, no remote stylesheets or images, and no runtime-injected
`<link>`/`<script>` pointing off-origin. This applies to the internal design
tools (`banner-poc`, `design-lab`, `logo-editor`, `design-catalogue`) exactly
as much as to the production pages. The only permitted off-origin destination
is the app's own Supabase backend.

Two reasons, both of which have already bitten this project: a third-party
`<link>` discloses every visitor's IP address and user-agent to that company,
and a render-blocking one in `<head>` measured **~324ms of blank screen** on a
cold load — in front of the loading screen whose whole job is to cover latency.

- **Fonts** are self-hosted in `assets/fonts/`, declared by `css/fonts.css`.
  That CSS is **generated — never hand-edit it**. To add a family, add its spec
  to `SPECS` in `scripts/fetch-fonts.js`, run `node scripts/fetch-fonts.js`,
  and commit the woff2 files plus the regenerated CSS.
- **Libraries** get vendored into `vendor/` (as `html2canvas-pro` already is),
  never referenced from a CDN.
- **Verify with `node scripts/check-no-external.js`** — it fails with exit 1
  and lists every offending file:line. Run it before committing anything that
  touches a page's `<head>` or adds a dependency. This regression is invisible
  in code review and only shows up in a network panel, which is why the check
  exists.

## The loading screen (splash)

Designed in `splash-poc.html` (the Splash Editor), rendered by
`js/utils/splash.js` + `css/splash.css`. Its design is saved as **two files
that must stay in step**:

- `assets/splash/splash-config.json` — the full config, fetched at runtime.
- `assets/splash/splash-vars.css` — **generated, never hand-edit**. Emits the
  visual half as `--sp-*-cfg` properties on `:root`, and is linked in every
  page's `<head>`.

The CSS exists because the JSON fetch measured **~330ms**: long enough for the
splash to appear in `css/splash.css`'s fallback design and then visibly
restyle itself. A loading screen that changes design while the user watches is
the flicker the whole rewrite set out to remove. So the `<link>` must stay in
`<head>`, and the fallbacks in `css/splash.css` are a safety net for a missing
stylesheet — not the design.

The editor's **Save to site** writes both. After editing the JSON by hand, run
`node scripts/build-splash-css.js` (`--check` verifies they match).

## URL contract

**The iron rule: a slug in the URL is ALWAYS the visible label, lowercased,
with spaces → hyphens. No exceptions, no mapping tables.** `Charts` →
`?tab=charts`. `Upload CSV` → `#…/upload-csv`. If a slug comes out too long,
**shorten the label, not the slug** — the URL is the thing a user reads aloud
and pastes into WhatsApp, and a URL that disagrees with the tab it opens is a
URL nobody can trust. The one function that performs the transform is
`tabSlug()` in `js/utils/queryString.js`; call sites **derive** their slug from
it rather than declaring both halves separately, so a label rename can't leave a
stale slug behind. This is not hypothetical: `?tab=insights` opened a tab called
Charts, `?tab=leaderboard` opened Leaders, and `#…/rounds` opened the Round
Editor, each written by hand as a pair that reads fine on its own line.

- **Main tabs push, second-tier state replaces.** `mountAppTabs`
  (`js/render/appTabs.js`) writes the active tab with `pushState` on a click,
  arrow key or hotkey and listens for `popstate`, so Back returns to the previous
  tab instead of leaving the page. Everything below tab level — filters, sort,
  ranges, accordions — uses `replaceState`: a filter is a refinement of where you
  already are, not a place you went.
- **The default is always omitted.** The first tab and the default admin view
  carry no param and no hash. A URL names only what differs from the default, so
  the shortest URL is always the canonical entry point.
- **Renames get a silent alias, never a redirect page.** `aliases: { insights:
  'charts' }` on the `mountAppTabs` call: the old slug activates the right tab
  and the URL is normalised with `replaceState`, so an already-shared link keeps
  working without polluting Back. Aliases are permanent and cost one line.
- **Never round-trip a query string through `URLSearchParams` to write one
  param.** Its serialiser encodes a space as `+` while `encodeURIComponent`
  (what `helpers.js` `leagueUrl()` uses) emits `%20`, so editing one param
  silently rewrote every other one — `?league=July%20 2026` became
  `?league=July+2026`, giving one league two different URLs depending on whether
  the page happened to have tabs. Use `spliceQueryParam()` from
  `js/utils/queryString.js`, which edits one param and leaves every other byte
  alone. Reading via `URLSearchParams` is fine; the asymmetry is serialise-only.
- **Boolean flags are valueless and read by presence.** `?edit`, `?preview` —
  never `?edit=1` or `?preview=true`. Read them with `hasUrlFlag()` from
  `js/utils/queryString.js`, which also honours the retired valued forms so old
  links keep working. The two used to disagree (`preview` read with `.has()`,
  `edit` with `=== '1'`), which meant `?preview=false` switched preview mode
  **on**.
- **Verify with `node scripts/check-url-contract.js`** — it fails with exit 1
  and lists every offending file:line. It checks each `mountAppTabs` tab set and
  its aliases, bans slug⇄panel mapping objects outright, checks the admin's view
  and nav tables, and validates every literal `?tab=` in `js/` and the HTML pages
  against the live slug set. Run it after touching any tab label, tab id, or nav
  slug.

Deliberately NOT in the URL today (each would be second-tier `replaceState`
state if added): league-type and match-length filters, table sort column and
direction, the H2H opponent on `player.html`, the dashboard's snapshot selector,
and accordion open state outside the admin's Match Results tabs.

## Key Conventions

- URL slugs = the visible label, kebab-cased — see § URL contract above; enforced by `scripts/check-url-contract.js`
- League IDs in URLs = folder names under `leagues/` (e.g., "Shabi Israel April 2026")
- `landing_settings.json` `DisplayOrder` titles use " - " (dash), folder names use " " (space) — `landingPage.js` handles the mapping
- Default flag is IL (Israel); custom flags per player are in `league_params.json` → `CustomFlags`
- League types (`LeagueType` in `league_params.json`): `"doubling"` (default — WinRate ranking), `"regular"` (wins-only, no PR/Luck), `"ubc"` (PR Wins + Points system). Config logic lives in `compute/leagueTypes.js`
- Rankings sort varies by league type: Doubling = WinRate DESC then MeanPR ASC; Regular = Wins DESC; UBC = Avg Points DESC then MeanPR ASC

## Plan Mode

When in Plan Mode, present the plan concisely and focused — use short bullet points, avoid lengthy explanations, and get straight to the actionable steps.
