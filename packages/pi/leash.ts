import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CommandAnalyzer, checkForUpdates, readLeashrc } from "../core/index.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("🔒 Leash active", "info");
    ctx.ui.setStatus("leash", "🔒 Leash active");

    const update = await checkForUpdates();
    if (update.hasUpdate) {
      ctx.ui.notify(
        `🔄 Leash ${update.latestVersion} available. Run: leash update (restart required)`,
        "warning"
      );
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const { allow } = readLeashrc(ctx.cwd);
    const analyzer = new CommandAnalyzer(ctx.cwd, allow);

    // Shell command execution
    if (event.toolName === "bash") {
      const command = (event.input.command as string) || "";
      const result = analyzer.analyze(command);

      if (result.blocked) {
        if (ctx.hasUI) {
          ctx.ui.notify(`🚫 Command blocked: ${result.reason}`, "warning");
        }
        return {
          block: true,
          reason:
            `Command blocked: ${command}\n` +
            `Reason: ${result.reason}\n` +
            `Working directory: ${ctx.cwd}\n` +
            `Action: Guide the user to run the command manually.`,
        };
      }
    }

    // File write/edit operations
    if (event.toolName === "write" || event.toolName === "edit") {
      const path = (event.input.path as string) || "";
      const result = analyzer.validatePath(path);

      if (result.blocked) {
        const suggestion = analyzer.suggestAllow(path);
        let reason =
          `File operation blocked: ${path}\n` +
          `Reason: ${result.reason}\n` +
          `Working directory: ${ctx.cwd}\n`;

        if (suggestion) {
          reason +=
            `Hint: This path is reachable via symlink "${suggestion}" in your working directory.\n` +
            `      Run: leash allow ${suggestion}\n`;
        }

        reason += `Action: Guide the user to perform this operation manually.`;

        if (ctx.hasUI) {
          ctx.ui.notify(`🚫 File operation blocked: ${result.reason}`, "warning");
        }
        return { block: true, reason };
      }
    }

    return undefined;
  });
}
