import { guardTool, type ToolInput } from "./guard.js";

export default async function Leash({ directory }: { directory: string }) {
  return {
    "tool.execute.before": (input: { tool: string }, output: { args?: ToolInput }) =>
      guardTool(directory, input.tool, output.args || {}),
  };
}
