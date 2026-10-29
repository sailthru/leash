import { CommandAnalyzer, readLeashrc } from "../core/index.js";

export type ToolInput = { command?: string; path?: string; script?: string; patchText?: string };

export function guardTool(directory: string, tool: string, input: ToolInput): void {
  const { allow } = readLeashrc(directory);
  const analyzer = new CommandAnalyzer(directory, allow);

  // Shell command execution
  const shellTools = ["execute", "bash", "shell"];
  if (shellTools.includes(tool)) {
    const command = input.command || input.script || "";
    const result = analyzer.analyze(command);

    if (result.blocked) {
      throw new Error(
        `Command blocked: ${command}\n` +
          `Reason: ${result.reason}\n` +
          `Working directory: ${directory}\n` +
          `Action: Guide the user to run the command manually.`
      );
    }
  }

  // File write/edit/patch operations
  const fileTools = ["write", "edit", "patch"];
  if (fileTools.includes(tool)) {
    const paths = [input.path || ""];
    if (tool === "patch" && typeof input.patchText === "string") {
      for (const line of input.patchText.split("\n")) {
        const target = line.trim().match(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/);
        if (target) paths.push(target[1].trim());
      }
    }
    for (const path of paths) {
      const result = analyzer.validatePath(path);

      if (result.blocked) {
        const suggestion = analyzer.suggestAllow(path);
        let msg =
          `File operation blocked: ${path}\n` +
          `Reason: ${result.reason}\n` +
          `Working directory: ${directory}\n`;

        if (suggestion) {
          msg +=
            `Hint: This path is reachable via symlink "${suggestion}" in your working directory.\n` +
            `      Run: leash allow ${suggestion}\n`;
        }

        msg += `Action: Guide the user to perform this operation manually.`;
        throw new Error(msg);
      }
    }
  }
}

