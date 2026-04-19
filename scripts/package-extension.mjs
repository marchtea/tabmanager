import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const releaseDir = path.join(rootDir, "release");
const zipPath = path.join(releaseDir, "tabmanager-extension.zip");

execFileSync("npm", ["run", "build"], {
  cwd: rootDir,
  stdio: "inherit"
});

mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });

execFileSync("zip", ["-qr", zipPath, "."], {
  cwd: distDir,
  stdio: "inherit"
});

const zipStats = await stat(zipPath);
console.log(`Created ${path.relative(rootDir, zipPath)} (${formatBytes(zipStats.size)})`);

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let index = 0; index < units.length; index += 1) {
    unit = units[index];
    if (value < 1024 || index === units.length - 1) {
      return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
    }
    value /= 1024;
  }

  return `${bytes} B`;
}
