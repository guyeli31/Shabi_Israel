# Gevkalil media

Put each file in the folder for its kind:

| Folder | What goes here | Formats |
|---|---|---|
| `images/` | Pictures shown with a question or an interlude | png, jpg, webp, gif, svg, avif |
| `videos/` | Clips | mp4, webm, m4v |
| `audio/` | Background music and sound clips | mp3, m4a, ogg, wav, aac |
| `backgrounds/` | Full-screen backdrops for the quiz | png, jpg, webp, svg, avif |

Then run, from the repo root:

```
node scripts/gevkalil-media-manifest.mjs
```

That rewrites `manifest.json`, which is what the editor's pickers list
(GitHub Pages cannot list a folder). Do not edit `manifest.json` by hand.

Rules the script enforces:

- File names use only `A-Z a-z 0-9 . _ -` — no spaces, no Hebrew.
- A file must be in the folder that matches its type.
- Nothing over 95 MB (GitHub refuses a push containing a 100 MB file).
  Keep videos short and compressed: the host screen downloads them live.

A new file is live only after it is committed and pushed.

The `demo-*` files belong to the demo quiz (`sql/gevkalil_demo_seed.sql`).
