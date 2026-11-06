import { defineConfig } from "vite";
import { resolve } from "path";

// Build config for the theme editor at quark.tel/theme (docs/theme).
//
// The page lives in src/theme-editor and shares src/theme with the app, so the
// editor's TOML, validation and preview CSS are the app's own code. Its output
// is committed like docs/demo — the Pages workflow deploys docs/ verbatim.
// At runtime it reaches outside its own directory for the landing page's
// ../style.css and fonts, and for the live preview, ../demo/ (same origin).
//
// Rebuild after editor or theme changes:
//   pnpm build:theme-editor
// Try it locally (the preview needs the sibling demo, so serve all of docs/):
//   python3 -m http.server -d docs 8080   →  http://localhost:8080/theme/
export default defineConfig({
  root: resolve(__dirname, "src/theme-editor"),
  base: "./",
  publicDir: false,
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: resolve(__dirname, "docs/theme"),
    emptyOutDir: true,
    target: "es2022",
  },
});
