import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, readFileSync, writeFileSync, lstatSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setupPlatform, removePlatform, readConfig } from "../lib/lib.js";

const TEST_DIR = join(tmpdir(), "leash-test-" + Date.now());
const LEASH_PATH = "/mock/path/to/leash.js";

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

function getConfigPath(name) {
  return join(TEST_DIR, `${name}.json`);
}

function writeTestConfig(name, config) {
  writeFileSync(getConfigPath(name), JSON.stringify(config, null, 2));
}

function readTestConfig(name) {
  return JSON.parse(readFileSync(getConfigPath(name), "utf-8"));
}

// OpenCode tests
test("opencode: setup on empty config", () => {
  setup();
  const configPath = getConfigPath("opencode-empty");

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.platform, "OpenCode");

  const config = readTestConfig("opencode-empty");
  assert.deepStrictEqual(config.plugin, [LEASH_PATH]);
  assert.strictEqual(config.permission.bash["leash allow *"], "ask");

  cleanup();
});

test("opencode: setup merges with existing plugin", () => {
  setup();
  const configPath = getConfigPath("opencode-merge");
  writeTestConfig("opencode-merge", {
    provider: "anthropic",
    plugin: ["/other/plugin.js"],
  });

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("opencode-merge");
  assert.strictEqual(config.provider, "anthropic");
  assert.deepStrictEqual(config.plugin, ["/other/plugin.js", LEASH_PATH]);

  cleanup();
});

test("opencode: setup skips if already installed", () => {
  setup();
  const configPath = getConfigPath("opencode-skip");
  writeTestConfig("opencode-skip", {
    plugin: [LEASH_PATH],
    permission: { bash: { "leash allow *": "ask" } },
  });

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.skipped, true);

  cleanup();
});

test("given obsolete leash path when setting up opencode then replaces it", () => {
  setup();
  const configPath = getConfigPath("opencode-replace");
  writeTestConfig("opencode-replace", {
    plugin: ["/old/node/leash.js"],
    permission: { bash: { "leash allow *": "ask" } },
  });

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(readTestConfig("opencode-replace").plugin, [LEASH_PATH]);

  cleanup();
});

test("given OpenCode V2 when setting up then migrates the plugin configuration", () => {
  setup();
  const configPath = getConfigPath("opencode-v2");
  writeTestConfig("opencode-v2", {
    plugin: ["/old/node/leash.js", "@other/plugin"],
    permission: { bash: { "leash allow *": "ask" } },
  });

  const result = setupPlatform("opencode", configPath, LEASH_PATH, true);
  const config = readTestConfig("opencode-v2");

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(config.plugins, ["@other/plugin"]);
  assert.strictEqual(config.plugin, undefined);
  assert.ok(lstatSync(join(TEST_DIR, "plugins", "leash.js")).isSymbolicLink());

  cleanup();
});

test("opencode: setup adds permission when plugin exists but permission missing", () => {
  setup();
  const configPath = getConfigPath("opencode-add-perm");
  writeTestConfig("opencode-add-perm", {
    plugin: ["/some/leash/path.js"],
  });

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("opencode-add-perm");
  assert.strictEqual(config.permission.bash["leash allow *"], "ask");

  cleanup();
});

test("opencode: setup converts string permission.bash to object", () => {
  setup();
  const configPath = getConfigPath("opencode-string-bash");
  writeTestConfig("opencode-string-bash", {
    plugin: ["/other/plugin.js"],
    permission: { bash: "allow" },
  });

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("opencode-string-bash");
  assert.deepStrictEqual(config.plugin, ["/other/plugin.js", LEASH_PATH]);
  assert.strictEqual(config.permission.bash["*"], "allow");
  assert.strictEqual(config.permission.bash["leash allow *"], "ask");

  cleanup();
});

test("opencode: setup skips permission if user has existing leash rule", () => {
  setup();
  const configPath = getConfigPath("opencode-user-perm");
  writeTestConfig("opencode-user-perm", {
    permission: { bash: { "leash *": "deny" } },
  });

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("opencode-user-perm");
  assert.strictEqual(config.permission.bash["leash *"], "deny");
  assert.strictEqual(config.permission.bash["leash allow *"], undefined);

  cleanup();
});

test("opencode: remove works", () => {
  setup();
  const configPath = getConfigPath("opencode-remove");
  writeTestConfig("opencode-remove", {
    provider: "anthropic",
    plugin: ["/other/plugin.js", LEASH_PATH],
    permission: { bash: { "leash allow *": "ask" } },
  });

  const result = removePlatform("opencode", configPath);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("opencode-remove");
  assert.strictEqual(config.provider, "anthropic");
  assert.deepStrictEqual(config.plugin, ["/other/plugin.js"]);
  assert.strictEqual(config.permission.bash["leash allow *"], undefined);

  cleanup();
});

test("opencode: remove when not installed", () => {
  setup();
  const configPath = getConfigPath("opencode-not-installed");
  writeTestConfig("opencode-not-installed", {
    plugin: ["/other/plugin.js"],
  });

  const result = removePlatform("opencode", configPath);

  assert.strictEqual(result.notInstalled, true);

  cleanup();
});

test("opencode: setup preserves JSONC comments", () => {
  setup();
  const configPath = join(TEST_DIR, "opencode-jsonc.jsonc");
  const jsoncContent = `{
  // Main settings
  "model": "claude-sonnet-4-20250514",
  /* Multi-line
     comment */
  "provider": "anthropic",
  "plugin": [
    "existing-plugin.js" // inline comment
  ]
}`;
  writeFileSync(configPath, jsoncContent);

  const result = setupPlatform("opencode", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const content = readFileSync(configPath, "utf-8");
  assert.ok(content.includes("// Main settings"), "should preserve single-line comment");
  assert.ok(content.includes("/* Multi-line"), "should preserve multi-line comment");
  assert.ok(content.includes("existing-plugin.js"), "should preserve existing plugin");
  assert.ok(content.includes(LEASH_PATH), "should add leash");

  cleanup();
});

test("opencode: remove preserves JSONC comments", () => {
  setup();
  const configPath = join(TEST_DIR, "opencode-jsonc-remove.jsonc");
  const jsoncContent = `{
  // Settings comment
  "model": "claude-sonnet-4-20250514",
  "plugin": [
    "other-plugin.js",
    "${LEASH_PATH}"
  ]
}`;
  writeFileSync(configPath, jsoncContent);

  const result = removePlatform("opencode", configPath);

  assert.strictEqual(result.success, true);

  const content = readFileSync(configPath, "utf-8");
  assert.ok(content.includes("// Settings comment"), "should preserve comment");
  assert.ok(content.includes("other-plugin.js"), "should preserve other plugin");
  assert.ok(!content.includes(LEASH_PATH), "should remove leash");

  cleanup();
});

// Pi tests
test("pi: setup on empty config", () => {
  setup();
  const configPath = getConfigPath("pi-empty");

  const result = setupPlatform("pi", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("pi-empty");
  assert.deepStrictEqual(config.extensions, [LEASH_PATH]);

  cleanup();
});

test("pi: setup merges with existing extensions", () => {
  setup();
  const configPath = getConfigPath("pi-merge");
  writeTestConfig("pi-merge", {
    extensions: ["/other/extension.js"],
  });

  const result = setupPlatform("pi", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("pi-merge");
  assert.deepStrictEqual(config.extensions, ["/other/extension.js", LEASH_PATH]);

  cleanup();
});

test("pi: remove works", () => {
  setup();
  const configPath = getConfigPath("pi-remove");
  writeTestConfig("pi-remove", {
    extensions: ["/other/extension.js", LEASH_PATH],
  });

  const result = removePlatform("pi", configPath);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("pi-remove");
  assert.deepStrictEqual(config.extensions, ["/other/extension.js"]);

  cleanup();
});

// Claude Code tests
test("claude-code: setup on empty config", () => {
  setup();
  const configPath = getConfigPath("claude-empty");

  const result = setupPlatform("claude-code", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("claude-empty");
  assert.strictEqual(config.hooks.SessionStart.length, 1);
  assert.strictEqual(
    config.hooks.SessionStart[0].hooks[0].command,
    `node ${LEASH_PATH}`
  );
  assert.strictEqual(config.hooks.PreToolUse.length, 1);
  assert.strictEqual(config.hooks.PreToolUse[0].matcher, "Bash|Write|Edit");
  assert.strictEqual(
    config.hooks.PreToolUse[0].hooks[0].command,
    `node ${LEASH_PATH}`
  );
  assert.deepStrictEqual(config.permissions.ask, ["Bash(leash allow *)"]);

  cleanup();
});

test("claude-code: setup merges with existing hooks", () => {
  setup();
  const configPath = getConfigPath("claude-merge");
  writeTestConfig("claude-merge", {
    permissions: { allow: ["Bash"] },
    hooks: {
      PreToolUse: [
        { matcher: ".*", hooks: [{ type: "command", command: "other-hook" }] },
      ],
    },
  });

  const result = setupPlatform("claude-code", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("claude-merge");
  assert.deepStrictEqual(config.permissions, {
    allow: ["Bash"],
    ask: ["Bash(leash allow *)"],
  });
  assert.strictEqual(config.hooks.SessionStart.length, 1);
  assert.strictEqual(config.hooks.PreToolUse.length, 2);
  assert.strictEqual(config.hooks.PreToolUse[0].matcher, ".*");
  assert.strictEqual(config.hooks.PreToolUse[1].matcher, "Bash|Write|Edit");

  cleanup();
});

test("claude-code: setup skips if already installed", () => {
  setup();
  const configPath = getConfigPath("claude-skip");
  writeTestConfig("claude-skip", {
    permissions: { ask: ["Bash(leash allow *)"] },
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: "node /path/to/leash.js" }],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash|Write|Edit",
          hooks: [{ type: "command", command: "node /path/to/leash.js" }],
        },
      ],
    },
  });

  const result = setupPlatform("claude-code", configPath, LEASH_PATH);

  assert.strictEqual(result.skipped, true);

  cleanup();
});

test("claude-code: setup adds permission when hooks exist but permission missing", () => {
  setup();
  const configPath = getConfigPath("claude-add-perm");
  writeTestConfig("claude-add-perm", {
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: "node /path/to/leash.js" }],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash|Write|Edit",
          hooks: [{ type: "command", command: "node /path/to/leash.js" }],
        },
      ],
    },
  });

  const result = setupPlatform("claude-code", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("claude-add-perm");
  assert.deepStrictEqual(config.permissions.ask, ["Bash(leash allow *)"]);

  cleanup();
});

test("claude-code: setup skips permission if user has existing leash rule", () => {
  setup();
  const configPath = getConfigPath("claude-user-perm");
  writeTestConfig("claude-user-perm", {
    permissions: { deny: ["Bash(leash *)"] },
  });

  const result = setupPlatform("claude-code", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("claude-user-perm");
  assert.deepStrictEqual(config.permissions.deny, ["Bash(leash *)"]);
  assert.strictEqual(config.permissions.ask, undefined);

  cleanup();
});

test("claude-code: remove works", () => {
  setup();
  const configPath = getConfigPath("claude-remove");
  writeTestConfig("claude-remove", {
    permissions: { allow: ["Bash"], ask: ["Bash(leash allow *)"] },
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: `node ${LEASH_PATH}` }],
        },
      ],
      PreToolUse: [
        { matcher: ".*", hooks: [{ type: "command", command: "other-hook" }] },
        {
          matcher: "Bash|Write|Edit",
          hooks: [{ type: "command", command: `node ${LEASH_PATH}` }],
        },
      ],
    },
  });

  const result = removePlatform("claude-code", configPath);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("claude-remove");
  assert.deepStrictEqual(config.permissions, { allow: ["Bash"] });
  assert.strictEqual(config.hooks.SessionStart.length, 0);
  assert.strictEqual(config.hooks.PreToolUse.length, 1);
  assert.strictEqual(config.hooks.PreToolUse[0].matcher, ".*");

  cleanup();
});

// Factory tests
test("factory: setup on empty config", () => {
  setup();
  const configPath = getConfigPath("factory-empty");

  const result = setupPlatform("factory", configPath, LEASH_PATH);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("factory-empty");
  assert.strictEqual(config.hooks.SessionStart.length, 1);
  assert.strictEqual(config.hooks.PreToolUse.length, 1);
  assert.strictEqual(config.hooks.PreToolUse[0].matcher, "Execute|Write|Edit");
  assert.deepStrictEqual(config.permissions.ask, ["Execute(leash allow *)"]);

  cleanup();
});

test("factory: remove works", () => {
  setup();
  const configPath = getConfigPath("factory-remove");
  writeTestConfig("factory-remove", {
    permissions: { ask: ["Execute(leash allow *)"] },
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: `node ${LEASH_PATH}` }],
        },
      ],
      PreToolUse: [
        {
          matcher: "Execute|Write|Edit",
          hooks: [{ type: "command", command: `node ${LEASH_PATH}` }],
        },
      ],
    },
  });

  const result = removePlatform("factory", configPath);

  assert.strictEqual(result.success, true);

  const config = readTestConfig("factory-remove");
  assert.strictEqual(config.hooks.SessionStart.length, 0);
  assert.strictEqual(config.hooks.PreToolUse.length, 0);
  assert.strictEqual(config.permissions.ask, undefined);

  cleanup();
});

// Error cases
test("unknown platform returns error", () => {
  const result = setupPlatform("unknown", "/path", LEASH_PATH);
  assert.ok(result.error);
  assert.ok(result.error.includes("Unknown platform"));
});

test("remove on non-existent config returns notFound", () => {
  const result = removePlatform("opencode", "/non/existent/path.json");
  assert.strictEqual(result.notFound, true);
});

test("readConfig returns empty object for non-existent file", () => {
  const config = readConfig("/non/existent/file.json");
  assert.deepStrictEqual(config, {});
});

test("readConfig throws on invalid JSON", () => {
  setup();
  const configPath = getConfigPath("invalid");
  writeFileSync(configPath, "not valid json");

  assert.throws(() => readConfig(configPath), /Invalid JSON\/JSONC/);

  cleanup();
});
