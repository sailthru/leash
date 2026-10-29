#!/usr/bin/env node
import { CommandAnalyzer, formatBlockMessage, readLeashrc, readStdin } from "../core/index.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface CodexHookInput {
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: { command?: string };
}

const PATCH_DIRECTIVE = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/;
const KNOWN_PATCH_MARKERS = new Set(["*** Begin Patch", "*** End Patch", "*** End of File"]);

function patchPaths(patch: string): string[] | null {
  const lines = patch.split("\n");
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return null;

  const paths: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("*** ")) continue;

    const directive = line.match(PATCH_DIRECTIVE);
    if (directive) {
      paths.push(directive[2]);
      continue;
    }

    if (!KNOWN_PATCH_MARKERS.has(line)) return null;
  }

  return paths;
}

function deny(reason: string): void {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
}

async function main() {
  let input: CodexHookInput;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    console.error("Failed to parse input JSON");
    process.exit(1);
  }

  if (input.hook_event_name === "SessionStart") {
    const message = "🔒 Leash configured; make sure its PreToolUse hook is trusted in /hooks.";
    try {
      const root = process.env.PLUGIN_ROOT!;
      const data = process.env.PLUGIN_DATA!;
      const { version } = JSON.parse(readFileSync(join(root, ".codex-plugin", "plugin.json"), "utf-8"));
      if (typeof version !== "string" || !version) throw new Error("Missing plugin version");
      const marker = join(data, "startup-reminder-version");
      try {
        if (readFileSync(marker, "utf-8") === version) return;
      } catch {
        // A missing marker means the reminder has not been shown yet.
      }
      mkdirSync(data, { recursive: true });
      writeFileSync(marker, version);
    } catch {
      // Repeating the reminder is safer than silently skipping it.
    }
    console.log(JSON.stringify({ systemMessage: message }));
    return;
  }

  if (input.hook_event_name !== "PreToolUse") return;

  const { allow } = readLeashrc(input.cwd);
  const analyzer = new CommandAnalyzer(input.cwd, allow);

  if (input.tool_name === "Bash") {
    const command = input.tool_input?.command || "";
    const result = analyzer.analyze(command);
    if (result.blocked) {
      deny(formatBlockMessage("Command blocked", command, result.reason!, input.cwd, analyzer));
    }
    return;
  }

  if (input.tool_name !== "apply_patch") return;

  const patch = input.tool_input?.command || "";
  const paths = patchPaths(patch);
  if (paths === null) {
    deny("Unsupported patch format. Leash blocks edits whose target paths cannot be verified.");
    return;
  }

  for (const path of paths) {
    const result = analyzer.validatePath(path);
    if (result.blocked) {
      deny(formatBlockMessage("File operation blocked", path, result.reason!, input.cwd, analyzer, path));
      return;
    }
  }
}

main();
