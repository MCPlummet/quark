import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    // Process real CSS instead of stubbing it, so a test can load base.css and
    // assert on computed style. NotificationToast.test.ts needs this: #80 was a
    // pure stylesheet bug that no DOM-level assertion could ever have caught.
    css: true,
    include: ["src/**/*.test.ts"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
