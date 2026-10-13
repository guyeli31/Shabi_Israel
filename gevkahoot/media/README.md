# GevKahoot media

Put each file in the folder for its kind:

| Folder | What goes here | Formats |
|---|---|---|
| `images/` | Pictures shown with a question or an interlude | png, jpg, webp, gif, svg, avif |
| `videos/` | Clips | mp4, webm, m4v |
| `audio/` | Background music and sound clips | mp3, m4a, ogg, wav, aac |
| `backgrounds/` | Full-screen backdrops for the quiz | png, jpg, webp, svg, avif |
| `sprites/` | Cut-out pictures for the bouncing animation (transparent background) | png, webp, svg, gif, avif |

Then run, from the repo root:

```
node scripts/gevkahoot-media-manifest.mjs
```

That rewrites `manifest.json`, which is what the editor's pickers list
(GitHub Pages cannot list a folder). Do not edit `manifest.json` by hand.

Rules the script enforces:

- A file name can be anything, Hebrew and spaces included, except these
  characters: `/ \ ? # % : * " < > |`, and it cannot start with a dot.
- A file must be in the folder that matches its type.
- Nothing over 95 MB (GitHub refuses a push containing a 100 MB file).
  Keep videos short and compressed: the host screen downloads them live.

A new file is live only after it is committed and pushed.

Sprites are usually made in the editor (Animation → "create from a picture"):
it cuts a free-hand shape out of any image and saves the PNG into `sprites/`
and updates `manifest.json` for you.

The `demo-*` files belong to the demo quiz (`sql/gevkahoot_demo_seed.sql`).
