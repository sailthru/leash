import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import * as jsonc from "jsonc-parser";

// Types
interface Config {
  plugin?: string[];
  plugins?: string[];
  extensions?: string[];
  hooks?: {
    SessionStart?: HookEntry[];
    PreToolUse?: HookEntry[];
  };
  permissions?: {
    allow?: string[];
    ask?: string[];
    deny?: string[];
  };
  permission?: {
    bash?: Record<string, string>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type: string; command: string }[];
}

interface SetupResult {
  success?: boolean;
  skipped?: boolean;
  error?: string;
  platform?: string;
  configPath?: string;
}

interface RemoveResult {
  success?: boolean;
  notFound?: boolean;
  notInstalled?: boolean;
  error?: string;
  platform?: string;
}

interface Platform {
  name: string;
  configPath?: string;
  configPaths?: string[];
  distPath: string;
  setup?: (config: Config, leashPath: string) => { skipped: boolean };
  remove?: (config: Config) => boolean;
}

function hasLeashPermission(config: Config): boolean {
  const hookPerms = [
    ...(config.permissions?.allow || []),
    ...(config.permissions?.ask || []),
    ...(config.permissions?.deny || []),
  ];
  if (hookPerms.some((p) => p.includes("leash"))) return true;

  const bashPerms = Object.keys(config.permission?.bash || {});
  if (bashPerms.some((k) => k.includes("leash"))) return true;

  return false;
}

function linkExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function createHookPlatform(opts: {
  name: string;
  configPath: string;
  distPath: string;
  preToolUseMatcher: string;
  bashToolName: string;
}): Platform {
  const askRule = `${opts.bashToolName}(leash allow *)`;

  return {
    name: opts.name,
    configPath: opts.configPath,
    distPath: opts.distPath,
    setup: (config: Config, leashPath: string) => {
      config.hooks = config.hooks || {};
      const hookCommand = { type: "command", command: `node ${leashPath}` };

      const inSessionStart = config.hooks.SessionStart?.some((entry) =>
        entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      const inPreToolUse = config.hooks.PreToolUse?.some((entry) =>
        entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      const hasPerm = hasLeashPermission(config);

      if (inSessionStart && inPreToolUse && hasPerm) {
        return { skipped: true };
      }

      if (!inSessionStart) {
        config.hooks.SessionStart = config.hooks.SessionStart || [];
        config.hooks.SessionStart.push({ hooks: [hookCommand] });
      }

      if (!inPreToolUse) {
        config.hooks.PreToolUse = config.hooks.PreToolUse || [];
        config.hooks.PreToolUse.push({
          matcher: opts.preToolUseMatcher,
          hooks: [hookCommand],
        });
      }

      if (!hasPerm) {
        config.permissions = config.permissions || {};
        config.permissions.ask = config.permissions.ask || [];
        config.permissions.ask.push(askRule);
      }

      return { skipped: false };
    },
    remove: (config: Config): boolean => {
      if (!config.hooks && !config.permissions) return false;
      let removed = false;

      if (config.hooks?.SessionStart) {
        const before = config.hooks.SessionStart.length;
        config.hooks.SessionStart = config.hooks.SessionStart.filter(
          (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
        );
        if (config.hooks.SessionStart.length < before) removed = true;
      }

      if (config.hooks?.PreToolUse) {
        const before = config.hooks.PreToolUse.length;
        config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
          (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
        );
        if (config.hooks.PreToolUse.length < before) removed = true;
      }

      if (config.permissions?.ask) {
        const before = config.permissions.ask.length;
        config.permissions.ask = config.permissions.ask.filter(
          (p) => p !== askRule
        );
        if (config.permissions.ask.length < before) removed = true;
        if (config.permissions.ask.length === 0) {
          delete config.permissions.ask;
        }
      }

      return removed;
    },
  };
}

export const PLATFORMS: Record<string, Platform> = {
  opencode: {
    name: "OpenCode",
    configPaths: [
      ".config/opencode/opencode.jsonc",
      ".config/opencode/opencode.json",
    ],
    distPath: "opencode/leash.js",
    // opencode config is JSONC (supports comments). Generic readConfig/writeConfig use JSON.stringify
    // which strips comments. setupOpenCode/removeOpenCode handle this via jsonc-parser instead.
  },
  pi: {
    name: "Pi",
    configPath: ".pi/agent/settings.json",
    distPath: "pi/leash.js",
    setup: (config: Config, leashPath: string) => {
      config.extensions = config.extensions || [];
      if (config.extensions.some((e) => e.includes("leash"))) {
        return { skipped: true };
      }
      config.extensions.push(leashPath);
      return { skipped: false };
    },
    remove: (config: Config): boolean => {
      if (!config.extensions) return false;
      const before = config.extensions.length;
      config.extensions = config.extensions.filter((e) => !e.includes("leash"));
      return config.extensions.length < before;
    },
  },
  "claude-code": createHookPlatform({
    name: "Claude Code",
    configPath: ".claude/settings.json",
    distPath: "claude-code/leash.js",
    preToolUseMatcher: "Bash|Write|Edit",
    bashToolName: "Bash",
  }),
  factory: createHookPlatform({
    name: "Factory",
    configPath: ".factory/settings.json",
    distPath: "factory/leash.js",
    preToolUseMatcher: "Execute|Write|Edit",
    bashToolName: "Execute",
  }),
  codex: {
    name: "Codex",
    distPath: "codex-marketplace",
  },
};

export function readConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    return {};
  }
  const content = readFileSync(configPath, "utf-8");
  const errors: jsonc.ParseError[] = [];
  const config = jsonc.parse(content, errors) as Config;
  if (errors.length > 0) {
    throw new Error(`Invalid JSON/JSONC in ${configPath}`);
  }
  return config;
}

export function writeConfig(configPath: string, config: Config): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function setupOpenCode(configPath: string, leashPath: string): SetupResult {
  const formatOptions: jsonc.FormattingOptions = { tabSize: 2, insertSpaces: true };

  let content = "";
  let config: Config = {};

  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
    const errors: jsonc.ParseError[] = [];
    config = jsonc.parse(content, errors) as Config;
    if (errors.length > 0) {
      return { error: `Invalid JSON/JSONC in ${configPath}` };
    }
  }

  const leashIndex = config.plugin?.findIndex((p) => p.includes("leash")) ?? -1;
  const hasPlugin = leashIndex !== -1;
  const hasCurrentPlugin = config.plugin?.[leashIndex] === leashPath;
  const hasPerm = hasLeashPermission(config);

  if (hasCurrentPlugin && hasPerm) {
    return { skipped: true, platform: "OpenCode" };
  }

  let updated = content;

  if (hasPlugin && !hasCurrentPlugin) {
    const edits = jsonc.modify(updated, ["plugin", leashIndex], leashPath, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, edits);
  } else if (!hasPlugin) {
    let edits: jsonc.EditResult;
    if (!config.plugin) {
      edits = jsonc.modify(updated, ["plugin"], [leashPath], { formattingOptions: formatOptions });
    } else {
      edits = jsonc.modify(updated, ["plugin", -1], leashPath, { formattingOptions: formatOptions });
    }
    updated = jsonc.applyEdits(updated, edits);
  }

  if (!hasPerm) {
    // If permission.bash is a string (e.g. "allow"), replace it with an object
    // preserving the original value as the default "*" rule
    if (typeof config.permission?.bash === "string") {
      const bashObj = { "*": config.permission.bash, "leash allow *": "ask" };
      const edits = jsonc.modify(updated, ["permission", "bash"], bashObj, { formattingOptions: formatOptions });
      updated = jsonc.applyEdits(updated, edits);
    } else {
      const edits = jsonc.modify(updated, ["permission", "bash", "leash allow *"], "ask", { formattingOptions: formatOptions });
      updated = jsonc.applyEdits(updated, edits);
    }
  }

  const newContent = updated;

  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, newContent);

  return { success: true, platform: "OpenCode", configPath };
}

function setupOpenCodeV2(configPath: string, leashPath: string): SetupResult {
  const formatOptions: jsonc.FormattingOptions = { tabSize: 2, insertSpaces: true };
  let content = "";
  let config: Config = {};

  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
    const errors: jsonc.ParseError[] = [];
    config = jsonc.parse(content, errors) as Config;
    if (errors.length > 0) return { error: `Invalid JSON/JSONC in ${configPath}` };
  }

  const pluginLink = join(dirname(configPath), "plugins", "leash.js");
  const configuredPlugins = (config.plugins || config.plugin || []).filter((plugin) => !plugin.includes("leash"));
  const hasPerm = hasLeashPermission(config);

  try {
    mkdirSync(dirname(pluginLink), { recursive: true });
    if (linkExists(pluginLink)) {
      if (!lstatSync(pluginLink).isSymbolicLink()) {
        return { error: `Refusing to replace non-symlink plugin file: ${pluginLink}` };
      }
      if (resolve(dirname(pluginLink), readlinkSync(pluginLink)) !== resolve(leashPath)) {
        unlinkSync(pluginLink);
        symlinkSync(leashPath, pluginLink);
      }
    } else {
      symlinkSync(leashPath, pluginLink);
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to install OpenCode plugin" };
  }

  let updated = content;
  const pluginEdits = jsonc.modify(updated, ["plugins"], configuredPlugins, { formattingOptions: formatOptions });
  updated = jsonc.applyEdits(updated, pluginEdits);
  if (config.plugin) {
    const legacyPluginEdits = jsonc.modify(updated, ["plugin"], undefined, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, legacyPluginEdits);
  }

  if (!hasPerm) {
    const bash = typeof config.permission?.bash === "string"
      ? { "*": config.permission.bash, "leash allow *": "ask" }
      : { ...(config.permission?.bash || {}), "leash allow *": "ask" };
    const permissionEdits = jsonc.modify(updated, ["permission", "bash"], bash, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, permissionEdits);
  }

  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, updated);
  return { success: true, platform: "OpenCode", configPath };
}

function removeOpenCode(configPath: string, leashPath?: string): RemoveResult {
  const hasConfig = existsSync(configPath);
  const content = hasConfig ? readFileSync(configPath, "utf-8") : "";
  const errors: jsonc.ParseError[] = [];
  const config = hasConfig ? jsonc.parse(content, errors) as Config : {};
  if (errors.length > 0) {
    return { error: `Invalid JSON/JSONC in ${configPath}` };
  }

  const leashIndex = config.plugin?.findIndex((p) => p.includes("leash")) ?? -1;
  const hasPerm = config.permission?.bash?.["leash allow *"] !== undefined;
  const pluginLink = join(dirname(configPath), "plugins", "leash.js");
  let removedLink = false;
  try {
    const managedTargets = leashPath ? [resolve(leashPath), resolve(dirname(leashPath), "leash.js")] : [];
    if (linkExists(pluginLink) && lstatSync(pluginLink).isSymbolicLink() &&
        managedTargets.includes(resolve(dirname(pluginLink), readlinkSync(pluginLink)))) {
      unlinkSync(pluginLink);
      removedLink = true;
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to remove OpenCode plugin" };
  }

  if (leashIndex === -1 && !hasPerm && !removedLink) {
    return hasConfig ? { notInstalled: true, platform: "OpenCode" } : { notFound: true, platform: "OpenCode" };
  }

  const formatOptions: jsonc.FormattingOptions = { tabSize: 2, insertSpaces: true };
  let updated = content;

  if (leashIndex !== -1) {
    const edits = jsonc.modify(updated, ["plugin", leashIndex], undefined, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, edits);
  }

  if (hasPerm) {
    const edits = jsonc.modify(updated, ["permission", "bash", "leash allow *"], undefined, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, edits);
  }

  if (hasConfig && (leashIndex !== -1 || hasPerm)) writeFileSync(configPath, updated);
  return { success: true, platform: "OpenCode" };
}

export function setupPlatform(platformKey: string, configPath: string, leashPath: string, openCodeV2 = false): SetupResult {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    return { error: `Unknown platform: ${platformKey}` };
  }

  if (platformKey === "opencode") {
    return openCodeV2 ? setupOpenCodeV2(configPath, leashPath) : setupOpenCode(configPath, leashPath);
  }

  const config = readConfig(configPath);
  if (!platform.setup) {
    return { error: `Platform ${platformKey} has no setup handler` };
  }
  const result = platform.setup(config, leashPath);

  if (result.skipped) {
    return { skipped: true, platform: platform.name };
  }

  writeConfig(configPath, config);
  return { success: true, platform: platform.name, configPath };
}

export function removePlatform(platformKey: string, configPath: string, leashPath?: string): RemoveResult {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    return { error: `Unknown platform: ${platformKey}` };
  }

  if (platformKey === "opencode") {
    return removeOpenCode(configPath, leashPath);
  }

  if (!existsSync(configPath)) {
    return { notFound: true, platform: platform.name };
  }

  const config = readConfig(configPath);
  if (!platform.remove) {
    return { error: `Platform ${platformKey} has no remove handler` };
  }
  const removed = platform.remove(config);

  if (!removed) {
    return { notInstalled: true, platform: platform.name };
  }

  writeConfig(configPath, config);
  return { success: true, platform: platform.name };
}
