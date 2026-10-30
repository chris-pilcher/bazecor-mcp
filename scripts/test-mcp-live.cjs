#!/usr/bin/env node
// GPL-3.0-only. Packaged-app smoke test, using only a disposable virtual keyboard.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bazecor-live-"));
  const virtualFile = path.join(temporary, "virtual.json");
  const app = await electron.launch({
    executablePath: process.env.BAZECOR_EXECUTABLE || path.join(root, "out/Bazecor-MCP-linux-x64/Bazecor-MCP"),
    args: [`--user-data-dir=${path.join(temporary, "profile")}`],
    timeout: 30000,
  });
  let client;
  try {
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialogSync = () => file;
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    }, virtualFile);
    const page = await app.firstWindow();
    page.on("dialog", dialog => dialog.accept().catch(() => {}));
    await page.waitForLoadState("domcontentloaded");
    await page
      .getByRole("button", { name: "Close", exact: true })
      .click()
      .catch(() => {});
    await page.getByRole("button", { name: /Add virtual keyboard/ }).click();
    await page.getByRole("button", { name: "Create new file", exact: true }).click();
    await page.getByRole("button", { name: "Enable local MCP", exact: true }).click();
    client = new Client({ name: "bazecor-live-smoke", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [path.join(root, "mcp/companion.cjs")] }),
    );
    assert.equal((await client.listTools()).tools.length, 5);
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      assert.ok(!response.isError, response.content[0].text);
      return JSON.parse(response.content[0].text);
    };
    const original = await call("read_draft");
    assert.equal(original.virtual, true, "Smoke test must only edit a virtual keyboard");
    const edited = await call("edit_draft", {
      expectedRevision: original.revision,
      edits: [
        { kind: "key", layer: 0, key: 0, keyCode: original.keys[0][0] === 4 ? 5 : 4 },
        { kind: "color", layer: 0, led: 0, palette: original.colors[0][0] === 0 ? 1 : 0 },
      ],
    });
    assert.equal(edited.dirty, true);
    const output = path.join(root, "out/mcp-smoke");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "staged.png") });
    const restored = await call("undo_draft", { expectedRevision: edited.revision });
    assert.deepEqual(restored.keys, original.keys);
    assert.deepEqual(restored.colors, original.colors);
    assert.equal((await call("export_draft")).format, "bazecor-mcp-layout-draft-v1");
    await page.locator('[data-key-index="0"]').first().click();
    await page
      .locator(".keycap")
      .filter({ hasText: /^\s*B\s*$/ })
      .locator(".shapeKey")
      .first()
      .click();
    const manual = await call("read_draft");
    assert.equal(manual.keys[0][0], 5, "Manual UI edit must be visible to MCP");
    await call("undo_draft", { expectedRevision: manual.revision });
    const fresh = await call("read_draft");
    const save = await client.callTool({
      name: "save_to_keyboard",
      arguments: { expectedRevision: fresh.revision, confirm: true },
    });
    assert.equal(save.isError, true, "Virtual hardware save must be rejected");
    assert.match(save.content[0].text, /virtual devices/);
    await page.getByRole("button", { name: "Disable MCP and disconnect clients" }).click();
    const disabled = await client.callTool({ name: "read_draft", arguments: {} });
    assert.equal(disabled.isError, true);
    console.log(
      "PASS: MCP SDK connection, read, visible staged key/color edit, undo, export, manual UI edit, virtual save guard and disable.",
    );
  } finally {
    await client?.close();
    await app.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
