import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const directory = fileURLToPath(new URL("../../../", import.meta.url));
const { default: Leash } = await import("../../../dist/opencode/leash.js");

const outsidePath = resolve(directory, "..", "leash-write-test.txt");

for (const platform of ["V2", "V1"]) {
  async function patchHook() {
    if (platform === "V1") {
      const hooks = await Leash.server({ directory });
      return (patchText) => hooks["tool.execute.before"]({ tool: "patch" }, { args: { patchText } });
    }
    let hook;
    await Leash.setup({
      location: { directory },
      tool: { hook: async (_name, callback) => { hook = callback; } },
    });
    return (patchText) => hook({ tool: "patch", input: { patchText } });
  }

  for (const operation of ["Add File", "Update File", "Delete File", "Move to"]) {
    test(`given ${platform} patch with outside ${operation} target when guarding then blocks`, async () => {
      const patch = await patchHook();
      assert.throws(
        () => patch(`*** Begin Patch\n*** Update File: inside.txt\n*** ${operation}: ${outsidePath}\n*** End Patch`),
        /File operation blocked/
      );
    });
  }

  test(`given ${platform} patch with relative escape when guarding then blocks`, async () => {
    const patch = await patchHook();
    assert.throws(() => patch("*** Begin Patch\n*** Add File: ../outside.txt\n+test\n*** End Patch"), /File operation blocked/);
  });

  test(`given ${platform} patch targeting protected file when guarding then blocks`, async () => {
    const patch = await patchHook();
    assert.throws(() => patch("*** Begin Patch\n*** Add File: .env\n+test\n*** End Patch"), /protected path/);
  });

  test(`given ${platform} patch with allowed targets when guarding then allows`, async () => {
    const patch = await patchHook();
    assert.doesNotThrow(() => patch(
      "*** Begin Patch\n*** Add File: new file.txt\n+test\n*** Update File: old.txt\n*** Move to: renamed.txt\n@@\n-old\n+new\n*** Delete File: obsolete.txt\n*** End Patch"
    ));
  });
}

test("given OpenCode V2 when initializing then blocks dangerous shell commands", async () => {
  let hook;
  await Leash.setup({
    location: { directory },
    tool: { hook: async (_name, callback) => { hook = callback; } },
  });

  assert.equal(typeof hook, "function");
  assert.throws(() => hook({ tool: "bash", input: { command: "rm -rf ~" } }), /Command blocked/);
});

test("given OpenCode V1 when initializing then blocks dangerous shell commands", async () => {
  const hooks = await Leash.server({ directory });

  assert.throws(
    () => hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "rm -rf ~" } }),
    /Command blocked/
  );
});
