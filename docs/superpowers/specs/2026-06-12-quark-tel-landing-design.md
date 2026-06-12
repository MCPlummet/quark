# quark.tel — landing page design

**Date:** 2026-06-12
**Status:** Approved (brainstorm)
**Branch:** `worktree-site` → PR into `main`

## Goal

A single static landing page for Quark, hosted on GitHub Pages at the custom
apex domain **quark.tel**. Primary call-to-action: **get the app** (download
installers from GitHub Releases). Secondary: GitHub repo.

## Non-goals (YAGNI)

- No documentation, blog, or changelog pages (single page only).
- No build step, framework, or bundler. Source files are the deploy artifact.
- No GitHub Actions deploy workflow (avoids colliding with the in-flight CI fix).

## Visual direction

Direction **C** from brainstorm: clean & modern with terminal accents. Dark,
on-brand — green-on-near-black, `#00ff41` accent, JetBrains Mono. Generous
whitespace, big type, one large app-window visual. Subtle terminal cues
(monospace eyebrow labels, a `:command` flourish, optional faint scanline),
not a full-screen TTY gimmick.

Palette anchors (from the app's own themes):
- background `#070b07` / `#050805`
- foreground `#cfe0cf`, dim `#7d8c7d`
- accent green `#00ff41`, dim green `#0c7a2c`, amber `#ffb000`
- border `#1c2a1c`

Respect `prefers-reduced-motion` (no cursor blink / drift when set), matching
the app's own behaviour. Mobile-responsive down to ~360px.

## Tech & structure

Hand-rolled static files, no build:

```
docs/
  index.html          # the page
  style.css           # all styles
  main.js             # OS detection for the download button (progressive enhancement)
  .nojekyll           # serve files as-is, no Jekyll build
  CNAME               # "quark.tel" — GitHub Pages custom domain
  assets/
    quarklogo512.png  # copied from src-tauri/icons
    favicon.png
    (screenshot.png)  # optional, swapped in later; CSS mockup used until then
```

`main.js` is progressive enhancement only: detect OS from `navigator` and set
the primary button's label + href to the matching Release asset. With JS off,
the button falls back to the GitHub Releases page and the full installer list
below still works.

## Page sections (single scroll)

1. **Hero** — eyebrow "A Matrix client", headline, one-line pitch, primary
   **Download** + ghost **GitHub** buttons, a small `v0.14.0 · AGPL-3.0 ·
   Linux · macOS · Windows` line.
2. **Screenshot** — one large Quark app-window visual. Built as a high-fidelity
   **CSS mockup** (room list + timeline + `:` command line) so the page ships
   looking finished. Marked swap point for a real PNG (`assets/screenshot.png`)
   later.
3. **Features** — grid of 6: end-to-end encryption, vim/quarkrc, custom emoji &
   stickers, GIF search, spaces, 11 live-switchable themes.
4. **"Why a GUI, not a TUI"** — short callout (the README's strongest hook).
5. **Get it / download** — installer list (.deb / .dmg / .msi / Flatpak →
   GitHub Releases) plus a "build from source" link.
6. **Footer** — GitHub, license (AGPL-3.0), "Matrix" wordmark courtesy line,
   "not affiliated with The Matrix.org Foundation".

## Deployment

GitHub Pages, **Deploy from a branch → `main` / `/docs`**. No workflow, no
`gh-pages` branch. `.nojekyll` + `CNAME` live in `/docs`. Pages serves the
static files directly; the source *is* the published site.

## Custom domain (quark.tel — apex)

After the site is live on `mcplummet.github.io/quark` (project page) we point
the apex domain at it:

1. Commit `docs/CNAME` containing `quark.tel`.
2. DNS at the registrar:
   - 4× `A` @ → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
     `185.199.111.153`
   - 4× `AAAA` @ → `2606:50c0:8000::153`, `2606:50c0:8001::153`,
     `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - `CNAME` `www` → `mcplummet.github.io.`
3. Repo Settings → Pages → set custom domain `quark.tel`, wait for DNS check,
   then enable **Enforce HTTPS** (cert auto-provisions).

Note: a **project page** custom domain works fine; GitHub serves the repo's
Pages site at the apex regardless of the `/quark` project path. The custom
domain maps to the project site directly.

## Testing / verification

- No unit tests (static page). Verify by serving `docs/` locally
  (`python3 -m http.server` or open `index.html`) and checking:
  - renders correctly, responsive at narrow widths,
  - download button OS-detection works and degrades without JS,
  - reduced-motion disables animation,
  - all links resolve (GitHub, Releases, source build).
- Validate HTML (no unclosed tags) and that relative asset paths work under the
  `/quark/` project path *and* under the apex domain root.

## Open follow-ups (post-merge)

- Swap CSS mockup for a real screenshot PNG.
- Confirm exact Release asset filenames once a tagged release exists, to make
  the OS-detect deep links exact (fallback = Releases page until then).
