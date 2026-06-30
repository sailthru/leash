import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // dist/platform (bundled) -> 2 levels up
  // packages/core/lib (source) -> 3 levels up
  const candidates = [
    join(__dirname, "..", "..", "package.json"),
    join(__dirname, "..", "..", "..", "package.json"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, "utf-8"));
        if (pkg.name === "@sailthru/leash") {
          return pkg.version;
        }
      } catch {
        // candidate not valid, try next
      }
    }
  }

  return "0.0.0";
}

export const CURRENT_VERSION: string = getVersion();

const VERSION_URL =
  "https://raw.githubusercontent.com/sailthru/leash/main/package.json";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion?: string;
  currentVersion: string;
}

function parseVersionPart(part: string): number {
  return parseInt(part.split(/[-_]/)[0], 10) || 0;
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split(".").map(parseVersionPart);
  const currentParts = current.split(".").map(parseVersionPart);
  const len = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < len; i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l !== c) return l > c;
  }
  return false;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(VERSION_URL);
    if (!response.ok) {
      return { hasUpdate: false, currentVersion: CURRENT_VERSION };
    }
    const data = (await response.json()) as { version: string };
    return {
      hasUpdate: isNewerVersion(data.version, CURRENT_VERSION),
      latestVersion: data.version,
      currentVersion: CURRENT_VERSION,
    };
  } catch {
    return { hasUpdate: false, currentVersion: CURRENT_VERSION };
  }
}
