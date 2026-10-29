import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import * as jsonc from "jsonc-parser";
function hasLeashPermission(config) {
  const hookPerms = [
    ...config.permissions?.allow || [],
    ...config.permissions?.ask || [],
    ...config.permissions?.deny || []
  ];
  if (hookPerms.some((p) => p.includes("leash"))) return true;
  const bashPerms = Object.keys(config.permission?.bash || {});
  if (bashPerms.some((k) => k.includes("leash"))) return true;
  return false;
}
function linkExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function createHookPlatform(opts) {
  const askRule = `${opts.bashToolName}(leash allow *)`;
  return {
    name: opts.name,
    configPath: opts.configPath,
    distPath: opts.distPath,
    setup: (config, leashPath) => {
      config.hooks = config.hooks || {};
      const hookCommand = { type: "command", command: `node ${leashPath}` };
      const inSessionStart = config.hooks.SessionStart?.some(
        (entry) => entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      const inPreToolUse = config.hooks.PreToolUse?.some(
        (entry) => entry.hooks?.some((h) => h.command?.includes("leash"))
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
          hooks: [hookCommand]
        });
      }
      if (!hasPerm) {
        config.permissions = config.permissions || {};
        config.permissions.ask = config.permissions.ask || [];
        config.permissions.ask.push(askRule);
      }
      return { skipped: false };
    },
    remove: (config) => {
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
    }
  };
}
const PLATFORMS = {
  opencode: {
    name: "OpenCode",
    configPaths: [
      ".config/opencode/opencode.jsonc",
      ".config/opencode/opencode.json"
    ],
    distPath: "opencode/leash.js"
    // opencode config is JSONC (supports comments). Generic readConfig/writeConfig use JSON.stringify
    // which strips comments. setupOpenCode/removeOpenCode handle this via jsonc-parser instead.
  },
  pi: {
    name: "Pi",
    configPath: ".pi/agent/settings.json",
    distPath: "pi/leash.js",
    setup: (config, leashPath) => {
      config.extensions = config.extensions || [];
      if (config.extensions.some((e) => e.includes("leash"))) {
        return { skipped: true };
      }
      config.extensions.push(leashPath);
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.extensions) return false;
      const before = config.extensions.length;
      config.extensions = config.extensions.filter((e) => !e.includes("leash"));
      return config.extensions.length < before;
    }
  },
  "claude-code": createHookPlatform({
    name: "Claude Code",
    configPath: ".claude/settings.json",
    distPath: "claude-code/leash.js",
    preToolUseMatcher: "Bash|Write|Edit",
    bashToolName: "Bash"
  }),
  factory: createHookPlatform({
    name: "Factory",
    configPath: ".factory/settings.json",
    distPath: "factory/leash.js",
    preToolUseMatcher: "Execute|Write|Edit",
    bashToolName: "Execute"
  }),
  codex: {
    name: "Codex",
    distPath: "codex-marketplace"
  }
};
function readConfig(configPath) {
  if (!existsSync(configPath)) {
    return {};
  }
  const content = readFileSync(configPath, "utf-8");
  const errors = [];
  const config = jsonc.parse(content, errors);
  if (errors.length > 0) {
    throw new Error(`Invalid JSON/JSONC in ${configPath}`);
  }
  return config;
}
function writeConfig(configPath, config) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
function setupOpenCode(configPath, leashPath) {
  const formatOptions = { tabSize: 2, insertSpaces: true };
  let content = "";
  let config = {};
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
    const errors = [];
    config = jsonc.parse(content, errors);
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
    let edits;
    if (!config.plugin) {
      edits = jsonc.modify(updated, ["plugin"], [leashPath], { formattingOptions: formatOptions });
    } else {
      edits = jsonc.modify(updated, ["plugin", -1], leashPath, { formattingOptions: formatOptions });
    }
    updated = jsonc.applyEdits(updated, edits);
  }
  if (!hasPerm) {
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
function setupOpenCodeV2(configPath, leashPath) {
  const formatOptions = { tabSize: 2, insertSpaces: true };
  let content = "";
  let config = {};
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
    const errors = [];
    config = jsonc.parse(content, errors);
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
    const legacyPluginEdits = jsonc.modify(updated, ["plugin"], void 0, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, legacyPluginEdits);
  }
  if (!hasPerm) {
    const bash = typeof config.permission?.bash === "string" ? { "*": config.permission.bash, "leash allow *": "ask" } : { ...config.permission?.bash || {}, "leash allow *": "ask" };
    const permissionEdits = jsonc.modify(updated, ["permission", "bash"], bash, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, permissionEdits);
  }
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, updated);
  return { success: true, platform: "OpenCode", configPath };
}
function removeOpenCode(configPath, leashPath) {
  const hasConfig = existsSync(configPath);
  const content = hasConfig ? readFileSync(configPath, "utf-8") : "";
  const errors = [];
  const config = hasConfig ? jsonc.parse(content, errors) : {};
  if (errors.length > 0) {
    return { error: `Invalid JSON/JSONC in ${configPath}` };
  }
  const leashIndex = config.plugin?.findIndex((p) => p.includes("leash")) ?? -1;
  const hasPerm = config.permission?.bash?.["leash allow *"] !== void 0;
  const pluginLink = join(dirname(configPath), "plugins", "leash.js");
  let removedLink = false;
  try {
    const managedTargets = leashPath ? [resolve(leashPath), resolve(dirname(leashPath), "leash.js")] : [];
    if (linkExists(pluginLink) && lstatSync(pluginLink).isSymbolicLink() && managedTargets.includes(resolve(dirname(pluginLink), readlinkSync(pluginLink)))) {
      unlinkSync(pluginLink);
      removedLink = true;
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to remove OpenCode plugin" };
  }
  if (leashIndex === -1 && !hasPerm && !removedLink) {
    return hasConfig ? { notInstalled: true, platform: "OpenCode" } : { notFound: true, platform: "OpenCode" };
  }
  const formatOptions = { tabSize: 2, insertSpaces: true };
  let updated = content;
  if (leashIndex !== -1) {
    const edits = jsonc.modify(updated, ["plugin", leashIndex], void 0, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, edits);
  }
  if (hasPerm) {
    const edits = jsonc.modify(updated, ["permission", "bash", "leash allow *"], void 0, { formattingOptions: formatOptions });
    updated = jsonc.applyEdits(updated, edits);
  }
  if (hasConfig && (leashIndex !== -1 || hasPerm)) writeFileSync(configPath, updated);
  return { success: true, platform: "OpenCode" };
}
function setupPlatform(platformKey, configPath, leashPath, openCodeV2 = false) {
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
function removePlatform(platformKey, configPath, leashPath) {
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
export {
  PLATFORMS,
  readConfig,
  removePlatform,
  setupPlatform,
  writeConfig
};
