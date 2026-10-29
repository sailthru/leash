import {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  lstatSync,
  realpathSync,
} from "fs";
import { dirname, join, resolve, relative } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { execFileSync, execSync } from "child_process";
import { createInterface } from "node:readline/promises";
import { PLATFORMS, setupPlatform, removePlatform } from "./lib.js";
import { checkForUpdates } from "../core/version-checker.js";
import { parseLeashrc } from "../core/leashrc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEASHRC = ".leashrc";

function getDistPath(): string {
  // Bundle is at dist/cli/leash.js, so dist/ is one level up
  return join(__dirname, "..");
}

function getConfigPath(platformKey: string): string | null {
  const platform = PLATFORMS[platformKey];
  if (!platform) return null;

  if (platform.configPaths) {
    for (const p of platform.configPaths) {
      const full = join(homedir(), p);
      if (existsSync(full)) return full;
    }
    return join(homedir(), platform.configPaths.at(-1)!);
  }

  return join(homedir(), platform.configPath!);
}

function getLeashPath(platformKey: string, openCodeV2 = platformKey === "opencode" && isOpenCodeV2()): string | null {
  const platform = PLATFORMS[platformKey];
  if (!platform) return null;
  return join(getDistPath(), platformKey === "opencode" && openCodeV2
    ? "opencode/leash-v2.js"
    : platform.distPath);
}

function isOpenCodeV2(): boolean {
  try {
    const version = execSync("opencode --version", { encoding: "utf-8" });
    return /^(?:opencode\s+)?v?2\./m.test(version.trim());
  } catch {
    return false;
  }
}

function setup(platformKey: string): void {
  if (platformKey === "codex") {
    setupCodex();
    return;
  }

  const configPath = getConfigPath(platformKey);
  const openCodeV2 = platformKey === "opencode" && isOpenCodeV2();
  const leashPath = getLeashPath(platformKey, openCodeV2);

  if (!configPath || !leashPath) {
    console.error(`Unknown platform: ${platformKey}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  if (!existsSync(leashPath)) {
    console.error(`Leash not found at: ${leashPath}`);
    process.exit(1);
  }

  const result = setupPlatform(platformKey, configPath, leashPath, openCodeV2);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.skipped) {
    console.log(`[ok] Leash already installed for ${result.platform}`);
    return;
  }

  console.log(`[ok] Config: ${result.configPath}`);
  console.log(`[ok] Leash installed for ${result.platform}`);
  console.log(`[ok] Restart ${result.platform} to apply changes`);
}

function remove(platformKey: string): void {
  if (platformKey === "codex") {
    removeCodex();
    return;
  }

  const configPath = getConfigPath(platformKey);

  if (!configPath) {
    console.error(`Unknown platform: ${platformKey}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  const result = removePlatform(platformKey, configPath, getLeashPath(platformKey, platformKey === "opencode") ?? undefined);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.notFound) {
    console.log(`[ok] No config found for ${result.platform}`);
    return;
  }

  if (result.notInstalled) {
    console.log(`[ok] Leash not found in ${result.platform} config`);
    return;
  }

  console.log(`[ok] Leash removed from ${result.platform}`);
  console.log(`[ok] Restart ${result.platform} to apply changes`);
}

function showPath(platformKey: string): void {
  const leashPath = getLeashPath(platformKey);

  if (!leashPath) {
    console.error(`Unknown platform: ${platformKey}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  console.log(leashPath);
}

function codexInstalledPlugins(): { pluginId: string }[] | null {
  try {
    const output = execFileSync("codex", ["plugin", "list", "--json"], { encoding: "utf-8" });
    return JSON.parse(output).installed;
  } catch {
    return null;
  }
}

function codexMarketplaces(): string[] | null {
  try {
    const output = execFileSync("codex", ["plugin", "marketplace", "list"], { encoding: "utf-8" });
    return output.split("\n").map((line) => line.trim().split(/\s{2,}/)[0]).filter(Boolean);
  } catch {
    return null;
  }
}

function setupCodex(): void {
  const marketplacePath = getLeashPath("codex");
  if (!marketplacePath || !existsSync(join(marketplacePath, ".agents", "plugins", "marketplace.json"))) {
    console.error(`Leash Codex plugin not found at: ${marketplacePath}`);
    process.exit(1);
  }

  const marketplaces = codexMarketplaces();
  if (marketplaces === null) {
    console.log("[ok] Codex is not installed; run 'leash setup codex' after installing it");
    return;
  }

  try {
    if (!marketplaces.includes("leash")) {
      execFileSync("codex", ["plugin", "marketplace", "add", marketplacePath], { stdio: "pipe" });
    }

    const plugins = codexInstalledPlugins();
    if (plugins === null) throw new Error("Unable to list Codex plugins");
    if (!plugins.some((plugin) => plugin.pluginId === "leash@leash")) {
      execFileSync("codex", ["plugin", "add", "leash@leash"], { stdio: "pipe" });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to install Codex plugin");
    process.exit(1);
  }

  console.log("[ok] Leash installed for Codex");
  console.log("[ok] In Codex, review and trust the Leash hook before using it");
  console.log("[ok] Restart the ChatGPT desktop app to use the installed plugin");
}

function setCodexPluginEnabled(enabled: boolean): void {
  const configPath = join(homedir(), ".codex", "config.toml");
  const section = '[plugins."leash@leash"]';
  const enabledLine = `enabled = ${enabled}`;
  const content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const sectionPattern = /\[plugins\."leash@leash"\][\s\S]*?(?=\n\[|$)/;
  const existing = content.match(sectionPattern);
  const updatedSection = existing
    ? existing[0].replace(/^enabled\s*=.*$/m, enabledLine).includes(enabledLine)
      ? existing[0].replace(/^enabled\s*=.*$/m, enabledLine)
      : `${existing[0].trimEnd()}\n${enabledLine}\n`
    : `${section}\n${enabledLine}\n`;
  const updated = existing
    ? content.replace(sectionPattern, updatedSection)
    : `${content}${content && !content.endsWith("\n") ? "\n" : ""}\n${updatedSection}`;

  if (updated !== content) {
    writeFileSync(configPath, updated);
  }
}

function removeCodex(): void {
  const marketplaces = codexMarketplaces();
  if (marketplaces === null) {
    console.log("[ok] Codex is not installed; no configuration was changed");
    return;
  }

  try {
    setCodexPluginEnabled(false);
    if (marketplaces.includes("leash")) {
      execFileSync("codex", ["plugin", "marketplace", "remove", "leash"], { stdio: "pipe" });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to remove Codex plugin");
    process.exit(1);
  }

  console.log("[ok] Leash removed from Codex configuration");
  console.log("[ok] Uninstall Leash in the ChatGPT desktop app to remove its cached copy");
}

async function update(): Promise<void> {
  console.log("Checking for updates...");

  const result = await checkForUpdates();

  if (!result.hasUpdate) {
    console.log(`[ok] Already up to date (v${result.currentVersion})`);
    return;
  }

  console.log(
    `[ok] Update available: v${result.currentVersion} → v${result.latestVersion}`
  );
  console.log("[ok] Updating...");

  try {
    execSync("npm install -g github:sailthru/leash", { stdio: "inherit" });
    console.log("[ok] Update complete");
    if (codexInstalledPlugins()?.some((plugin) => plugin.pluginId === "leash@leash")) {
      console.log("[ok] In Codex, refresh or reinstall Leash, then review and trust the updated hook");
    }
  } catch {
    console.error(
      "[error] Update failed. Try manually: npm install -g github:sailthru/leash"
    );
    process.exit(1);
  }
}

// .leashrc helpers

function leashrcPath(): string {
  return join(process.cwd(), LEASHRC);
}

function ensureLeashrcNotSymlink(): void {
  const p = leashrcPath();
  try {
    if (lstatSync(p).isSymbolicLink()) {
      console.error("[error] .leashrc is a symlink — refusing to operate");
      process.exit(1);
    }
  } catch {
    // File doesn't exist yet, that's fine
  }
}

function readAllowList(): string[] {
  const p = leashrcPath();
  try {
    const content = readFileSync(p, "utf-8");
    return parseLeashrc(content).allow;
  } catch {
    return [];
  }
}

function writeAllowList(paths: string[]): void {
  ensureLeashrcNotSymlink();
  const content =
    paths.length > 0 ? `[allow]\n${paths.join("\n")}\n` : `[allow]\n`;
  writeFileSync(leashrcPath(), content, "utf-8");
}

// allow command

function allow(pathArg: string): void {
  const resolved = resolve(process.cwd(), pathArg);

  // leash allow . is a no-op
  try {
    if (realpathSync(resolved) === realpathSync(process.cwd())) {
      return;
    }
  } catch {
    // If cwd can't be resolved, fall through to existence check
  }

  if (!existsSync(resolved)) {
    console.error(`[error] Path does not exist: ${resolved}`);
    process.exit(1);
  }

  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    console.error(`[error] Cannot resolve path: ${resolved}`);
    process.exit(1);
  }

  if (!statSync(realPath).isDirectory()) {
    console.error(`[error] Not a directory: ${realPath}`);
    process.exit(1);
  }

  // Must be within $HOME
  const realHome = realpathSync(homedir());
  const rel = relative(realHome, realPath);
  if (!rel || rel.startsWith("..") || rel.startsWith("/")) {
    console.error(
      `[error] Path must be within your home directory: ${realPath}`
    );
    process.exit(1);
  }

  ensureLeashrcNotSymlink();

  const current = readAllowList();

  // Idempotent
  if (current.includes(realPath)) {
    return;
  }

  current.push(realPath);
  writeAllowList(current);
  console.log(`[ok] Allowed: ${realPath}`);
}

// interactive helpers

function formatNumberedList(items: string[]): string {
  return items.map((item, i) => `  ${i + 1}. ${item}`).join("\n");
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function parseSelection(answer: string, max: number): number | null {
  if (answer === "q" || answer === "") return null;
  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 1 || num > max) {
    console.error("[error] Invalid selection");
    process.exit(1);
  }
  return num;
}

// revoke command

async function revoke(pathArg?: string): Promise<void> {
  if (pathArg === "--all") {
    ensureLeashrcNotSymlink();
    writeAllowList([]);
    console.log("[ok] Allowlist cleared");
    return;
  }

  const current = readAllowList();

  if (pathArg) {
    let resolved: string;
    try {
      const abs = resolve(process.cwd(), pathArg);
      resolved = existsSync(abs) ? realpathSync(abs) : abs;
    } catch {
      resolved = resolve(process.cwd(), pathArg);
    }

    const idx = current.indexOf(resolved);
    if (idx === -1) {
      console.log(
        `Path not in allowlist. Run 'leash revoke' to interactively select one.`
      );
      return;
    }

    current.splice(idx, 1);
    writeAllowList(current);
    console.log(`[ok] Revoked: ${resolved}`);
    return;
  }

  // Interactive mode
  if (current.length === 0) {
    console.log("Allowlist is empty");
    return;
  }

  const prompt =
    `Allowed directories:\n${formatNumberedList(current)}\n\n` +
    "Pick a number to revoke (or q to cancel): ";
  const answer = await promptLine(prompt);
  const selection = parseSelection(answer, current.length);
  if (selection === null) return;

  const removed = current.splice(selection - 1, 1)[0];
  writeAllowList(current);
  console.log(`[ok] Revoked: ${removed}`);
}

// list command

function list(): void {
  const current = readAllowList();
  if (current.length === 0) {
    console.log("No directories in allowlist");
    return;
  }
  for (const p of current) {
    console.log(p);
  }
}

function showHelp(): void {
  console.log(`
leash - Security guardrails for AI coding agents

Usage:
  leash setup <platform>    Install leash for a platform
  leash remove <platform>   Remove leash from a platform
  leash path <platform>     Show leash path for a platform
  leash update              Update leash to latest version
  leash allow <path>        Allow agent access to a directory
  leash revoke [path]       Revoke access (interactive if no path)
  leash revoke --all        Revoke all allowed directories
  leash list                List allowed directories
  leash help                Show this help

Platforms:
  opencode      OpenCode
  pi            Pi Coding Agent
  claude-code   Claude Code
  factory       Factory Droid
  codex         Codex CLI and ChatGPT desktop app

Examples:
  leash setup claude-code
  leash allow ~/src/other-project
  leash revoke
  leash list
`);
}

const args = process.argv.slice(2);
const command = args[0];
const arg = args[1];

switch (command) {
  case "setup":
    if (!arg) {
      console.error("Missing platform argument");
      showHelp();
      process.exit(1);
    }
    setup(arg);
    break;
  case "remove":
    if (!arg) {
      console.error("Missing platform argument");
      showHelp();
      process.exit(1);
    }
    remove(arg);
    break;
  case "path":
    if (!arg) {
      console.error("Missing platform argument");
      showHelp();
      process.exit(1);
    }
    showPath(arg);
    break;
  case "update":
    await update();
    break;
  case "allow":
    if (!arg) {
      console.error("Missing path argument");
      showHelp();
      process.exit(1);
    }
    allow(arg);
    break;
  case "revoke":
    await revoke(arg);
    break;
  case "list":
    list();
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
