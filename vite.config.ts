import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

export default defineConfig({
  plugins: [react(), extensionManifestMetadataPlugin()],
  build: {
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve("index.html"),
        background: path.resolve("src/background.ts")
      },
      output: {
        entryFileNames: "assets/[name].js"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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

const manifestDescriptionLimit = 132;
const extensionBaseName = "TabDock";
const generatedDescriptionPrefix = "TabDock workspace manager.";

function extensionManifestMetadataPlugin(): Plugin {
  return {
    name: "tabdock-extension-manifest-metadata",
    apply: "build",
    async closeBundle() {
      const manifestPath = path.resolve("dist", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        action?: {
          default_title?: string;
        };
        description?: string;
        name?: string;
        version?: string;
        version_name?: string;
      };
      const chromeVersion = formatChromeVersion(getNearestGitTagName(), manifest.version ?? "0.0.0");
      const extensionName = extensionBaseName;

      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            ...manifest,
            name: extensionName,
            version: chromeVersion,
            version_name: chromeVersion,
            action: {
              ...manifest.action,
              default_title: extensionName
            },
            description: formatExtensionDescription(getGitBranchName())
          },
          null,
          2
        )}\n`
      );
    }
  };
}

function getNearestGitTagName(): string {
  return runGit(["describe", "--tags", "--abbrev=0", "HEAD"]);
}

function getGitBranchName(): string {
  const branch = runGit(["branch", "--show-current"]);
  return branch || runGit(["rev-parse", "--short", "HEAD"]) || "unknown";
}

function runGit(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function formatExtensionDescription(branchName: string): string {
  const suffixPrefix = " Branch: ";
  const maxBranchLength =
    manifestDescriptionLimit - generatedDescriptionPrefix.length - suffixPrefix.length;
  const branch =
    branchName.length > maxBranchLength
      ? `${branchName.slice(0, Math.max(0, maxBranchLength - 3))}...`
      : branchName;

  return `${generatedDescriptionPrefix}${suffixPrefix}${branch}`;
}

function formatChromeVersion(tagName: string, fallbackVersion: string): string {
  const candidateVersion = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  const versionParts = candidateVersion
    .match(/\d+/g)
    ?.slice(0, 4)
    .map((part) => String(Math.min(Number.parseInt(part, 10), 65535)))
    .filter(Boolean);

  return versionParts?.length ? versionParts.join(".") : fallbackVersion;
}
