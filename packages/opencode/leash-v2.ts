import type { Plugin as OpenCodePlugin } from "@opencode/plugin";
import { guardTool, type ToolInput } from "./guard.js";

const Leash: OpenCodePlugin.Plugin = {
  id: "sailthru.leash",
  async setup(ctx) {
    const directory = ctx.location.directory;
    await ctx.tool.hook("execute.before", (event) => {
      guardTool(directory, event.tool, event.input as ToolInput);
    });
  },
};

export default Leash;
