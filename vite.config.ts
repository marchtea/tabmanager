import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    coverage: {
      reporter: ["text", "json", "html"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      },
      include: ["src/domain/**/*.ts", "src/chrome/**/*.ts"],
      exclude: ["src/domain/types.ts", "src/chrome/chromeTypes.ts"]
    }
  }
});
