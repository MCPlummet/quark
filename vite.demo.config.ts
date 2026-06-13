import { defineConfig } from "vite";
import { resolve } from "path";

// Build config for the public landing-page demo (docs/demo).
//
// Produces the real frontend running in ?debug mock mode. A guard script is
// injected at the very top of <head> so the demo ALWAYS runs in debug/mock
// mode — visiting docs/demo/ without ?debug can never expose the (mock) login
// screen. The guard rewrites the URL in place (no reload) before the app's
// deferred module script evaluates, so main.ts reads ?debug on first boot.
//
// Rebuild after app changes:
//   pnpm exec vite build --config vite.demo.config.ts
const FORCE_DEBUG =
  `(function(){try{var p=new URLSearchParams(location.search);` +
  `if(!p.has("debug")){p.set("debug","");` +
  `history.replaceState(null,"",location.pathname+"?"+p.toString()+location.hash);}}catch(e){}})();`;

export default defineConfig({
  base: "./",
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: { outDir: "docs/demo", emptyOutDir: true },
  plugins: [
    {
      name: "quark-demo-force-debug",
      transformIndexHtml() {
        return [{ tag: "script", injectTo: "head-prepend", children: FORCE_DEBUG }];
      },
    },
  ],
});
