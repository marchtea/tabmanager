import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const extensionPath = path.resolve("dist");
const requiredPermissions = ["storage", "tabs", "windows", "history", "scripting"];

test.describe("built Chrome extension package", () => {
  test("emits the MV3 manifest required by the PRD", async () => {
    const manifest = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8"));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.chrome_url_overrides).toEqual({ newtab: "index.html" });
    expect(manifest.permissions).toEqual(expect.arrayContaining(requiredPermissions));
    expect(manifest.host_permissions).toContain("<all_urls>");
  });

  test("loads dist as a headed Chrome extension and overrides the new tab page", async () => {
    test.skip(Boolean(process.env.CI), "Chrome extension newtab override requires headed Chromium.");

    const userDataDir = await mkdtemp(path.join(tmpdir(), "tabmanager-extension-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    try {
      const page = await context.newPage();
      await page.goto("chrome://newtab/");

      await expect(page).toHaveTitle("Tab Manager");
      await expect(page.getByTestId("tab-manager-shell")).toBeVisible();
      expect(page.url()).toMatch(/^chrome-extension:\/\/.+\/index\.html$/);

      const chromeApiState = await page.evaluate(async () => {
        const queriedTabs = await chrome.tabs.query({});
        return {
          runtimeId: chrome.runtime.id,
          storage: Boolean(chrome.storage?.local),
          tabs: Boolean(chrome.tabs?.query),
          windows: Boolean(chrome.windows?.update),
          history: Boolean(chrome.history?.search),
          scripting: Boolean(chrome.scripting?.executeScript),
          queriedTabCount: queriedTabs.length
        };
      });

      expect(chromeApiState.runtimeId).toBeTruthy();
      expect(chromeApiState).toMatchObject({
        storage: true,
        tabs: true,
        windows: true,
        history: true,
        scripting: true
      });
      expect(chromeApiState.queriedTabCount).toBeGreaterThan(0);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  });
});
