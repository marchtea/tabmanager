import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/extension",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-extension", open: "never" }]],
  timeout: 60_000,
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  }
});
