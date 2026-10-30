import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = fileURLToPath(new URL("../../../", import.meta.url));
const plugin = resolve(directory, "dist/codex-marketplace/plugin");
const leash = resolve(plugin, "hooks/leash.mjs");

test("given built Codex plugin when discovering hooks then uses the hook-capable manifest format", () => {
  assert.ok(!existsSync(resolve(plugin, "plugin.json")), "Codex 0.165 skips hooks for portable manifests");
  const manifest = JSON.parse(readFileSync(resolve(plugin, ".codex-plugin/plugin.json"), "utf-8"));
  const hooks = JSON.parse(readFileSync(resolve(plugin, manifest.hooks), "utf-8"));
  assert.equal(hooks.hooks.PreToolUse[0].matcher, "Bash|apply_patch");
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, 'node "${PLUGIN_ROOT}/hooks/leash.mjs"');
  assert.ok(existsSync(leash));
});

test("given a plugin version when starting sessions then reminds once per version", () => {
  const temp = mkdtempSync(join(tmpdir(), "leash-codex-start-"));
  try {
    const root = join(temp, "plugin");
    const data = join(temp, "data");
    mkdirSync(join(root, ".codex-plugin"), { recursive: true });
    const manifest = join(root, ".codex-plugin", "plugin.json");
    const start = () => execFileSync("node", [leash], {
      encoding: "utf-8",
      env: { ...process.env, PLUGIN_ROOT: root, PLUGIN_DATA: data },
      input: JSON.stringify({ cwd: directory, hook_event_name: "SessionStart" }),
    });
    writeFileSync(manifest, JSON.stringify({ version: "1.1.0" }));
    assert.match(JSON.parse(start()).systemMessage, /PreToolUse.*trusted.*\/hooks/);
    assert.equal(start(), "");
    writeFileSync(manifest, JSON.stringify({ version: "1.2.0" }));
    assert.match(JSON.parse(start()).systemMessage, /Leash configured/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("given unavailable plugin data when starting a session then still reminds", () => {
  const output = execFileSync("node", [leash], {
    encoding: "utf-8",
    env: { ...process.env, PLUGIN_ROOT: "", PLUGIN_DATA: "" },
    input: JSON.stringify({ cwd: directory, hook_event_name: "SessionStart" }),
  });
  assert.match(JSON.parse(output).systemMessage, /PreToolUse.*trusted.*\/hooks/);
});
const outsidePath = resolve(directory, "..", "codex-write-test.txt");

function hook(input) {
  const output = execFileSync("node", [leash], {
    cwd: directory,
    encoding: "utf-8",
    input: JSON.stringify({ cwd: directory, hook_event_name: "PreToolUse", ...input }),
  });
  return JSON.parse(output || "{}");
}

function blocked(input) {
  return hook(input).hookSpecificOutput?.permissionDecision === "deny";
}

test("given dangerous Bash command when Codex hook runs then blocks it", () => {
  assert.ok(blocked({ tool_name: "Bash", tool_input: { command: "rm -rf ~" } }));
});

test("given touch outside the working directory when Codex hook runs then blocks it", () => {
  assert.ok(blocked({ tool_name: "Bash", tool_input: { command: "touch ../more_stuff/file.txt" } }));
});

test("given outside apply_patch target when Codex hook runs then blocks it", () => {
  assert.ok(blocked({
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Add File: ${outsidePath}\n+test\n*** End Patch` },
  }));
});

test("given protected apply_patch target when Codex hook runs then blocks it", () => {
  assert.ok(blocked({
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Update File: .env\n*** End Patch" },
  }));
});

test("given move with outside source when Codex hook runs then blocks it", () => {
  assert.ok(blocked({
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Update File: ${outsidePath}\n*** Move to: renamed.txt\n*** End Patch` },
  }));
});

test("given malformed apply_patch when Codex hook runs then blocks it", () => {
  assert.ok(blocked({
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Unknown File: file.txt\n*** End Patch" },
  }));
});

test("given allowed apply_patch targets when Codex hook runs then allows it", () => {
  assert.deepStrictEqual(hook({
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Add File: new.txt\n+test\n*** Update File: old.txt\n*** Move to: renamed.txt\n*** Delete File: obsolete.txt\n*** End Patch" },
  }), {});
});
