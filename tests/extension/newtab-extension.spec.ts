import { chromium, expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const extensionPath = path.resolve("dist");
const requiredPermissions = ["storage", "tabs", "windows", "history", "scripting"];
const expectedExtensionId = "njjajlbhhkkdchmicnpomaimigohlpda";
const execFileAsync = promisify(execFile);

test.describe("built Chrome extension package", () => {
  test("emits the MV3 manifest required by the PRD", async () => {
    const manifest = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8"));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.chrome_url_overrides).toEqual({ newtab: "index.html" });
    expect(manifest.background).toEqual({ service_worker: "assets/background.js", type: "module" });
    expect(manifest.key).toBeTruthy();
    expect(manifest.commands["open_global_search"].suggested_key).toEqual({
      default: "Ctrl+Shift+K",
      mac: "Command+Shift+K"
    });
    expect(manifest.permissions).toEqual(expect.arrayContaining(requiredPermissions));
    expect(manifest.host_permissions).toContain("<all_urls>");
  });

  test("includes the current git branch in the generated extension description", async () => {
    const manifest = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8"));
    const currentBranch = await getCurrentBranchName();

    expect(manifest.description).toContain(`Branch: ${currentBranch}`);
  });

  test("uses the nearest git tag as the Chrome-compatible extension version", async () => {
    const manifest = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8"));
    const chromeVersion = await getNearestGitTagChromeVersion();

    expect(manifest.name).toBe("TabDock");
    expect(manifest.version).toBe(chromeVersion);
    expect(manifest.version_name).toBe(chromeVersion);
    expect(manifest.action.default_title).toBe("TabDock");
  });

  test("loads dist as a headed Chrome extension and overrides the new tab page", async () => {
    test.skip(Boolean(process.env.CI), "Chrome extension newtab override requires headed Chromium.");

    const userDataDir = await mkdtemp(path.join(tmpdir(), "tabdock-extension-"));
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

      await expect(page).toHaveTitle("TabDock");
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

      expect(chromeApiState.runtimeId).toBe(expectedExtensionId);
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

const getCurrentBranchName = async (): Promise<string> => {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd: process.cwd() });
  return stdout.trim();
};

const getNearestGitTagChromeVersion = async (): Promise<string> => {
  const { stdout } = await execFileAsync("git", ["describe", "--tags", "--abbrev=0", "HEAD"], {
    cwd: process.cwd()
  });

  return formatChromeVersion(stdout.trim());
};

const formatChromeVersion = (tag: string): string => {
  const normalizedTag = tag.startsWith("v") ? tag.slice(1) : tag;
  const versionParts = normalizedTag
    .match(/\d+/g)
    ?.slice(0, 4)
    .map((part) => String(Math.min(Number.parseInt(part, 10), 65535)))
    .filter(Boolean);

  return versionParts?.length ? versionParts.join(".") : "0.0.0";
};
