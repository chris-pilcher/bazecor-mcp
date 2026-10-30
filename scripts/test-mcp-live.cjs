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
    env: { ...process.env, BAZECOR_MCP_RUNTIME_DIR: path.join(temporary, "mcp") },
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
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(root, "mcp/companion.cjs")],
        env: { BAZECOR_MCP_RUNTIME_DIR: path.join(temporary, "mcp") },
      }),
    );
    const toolNames = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ["read_draft", "edit_draft", "open_editor", "list_actions", "import_backup", "save_to_keyboard"])
      assert.ok(toolNames.includes(name), name);
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      assert.ok(!response.isError, response.content[0].text);
      return JSON.parse(response.content[0].text);
    };
    const waitDraft = async editor => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await client.callTool({ name: "read_draft", arguments: { includePrivate: true } });
        if (!result.isError) {
          const value = JSON.parse(result.content[0].text);
          if (value.editor === editor) return value;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Editor ${editor} did not load`);
    };
    const original = await waitDraft("layout");
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
    let current = await waitDraft("layout");
    const supported = await call("list_actions", { query: "Shift to layer", limit: 100 });
    assert.ok(supported.actions.some(action => action.code === 17450));
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [
        { kind: "action", layer: 0, key: 0, actionId: "keycode:17450" },
        { kind: "layer_name", layer: 0, name: "MCP layout" },
        { kind: "palette", slot: 0, color: { r: 12, g: 34, b: 56 } },
      ],
    });
    assert.equal(current.keys[0][0], 17450);
    assert.ok((await call("diff_draft")).totalChanges > 0);
    const blocked = await client.callTool({ name: "open_editor", arguments: { editor: "macros" } });
    assert.equal(blocked.isError, true);
    await call("discard_draft", { expectedRevision: current.revision });
    await call("open_editor", { editor: "macros" });
    current = await waitDraft("macros");
    const macroIndex = current.macros.length;
    const actions = [
      { type: 1, keyCode: [10, 20] },
      { type: 2, keyCode: 256 },
      { type: 8, keyCode: 5 },
    ];
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "macro_put", index: macroIndex, name: "MCP smoke", actions }],
    });
    assert.equal(current.macros[macroIndex].actions, undefined, "Mutation response must redact private macro steps");
    assert.deepEqual((await call("read_draft", { includePrivate: true })).macros[macroIndex].actions, actions);
    let scratch = macroIndex + 1;
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "macro_put", index: scratch, name: "Scratch", actions: [{ type: 8, keyCode: 6 }] }],
    });
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "macro_put", index: scratch, name: "Renamed scratch", actions: [{ type: 8, keyCode: 7 }] }],
    });
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "macro_delete", index: scratch }],
    });
    current = await call("save_to_keyboard", { expectedRevision: current.revision, confirm: true });
    assert.equal(current.dirty, false);
    await call("open_editor", { editor: "superkeys" });
    current = await waitDraft("superkeys");
    const superIndex = current.superkeys.length;
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [
        { kind: "superkey_put", index: superIndex, name: "MCP super", actions: [4, 1, 53852 + macroIndex, 1, 1] },
      ],
    });
    current = await call("save_to_keyboard", { expectedRevision: current.revision, confirm: true });
    assert.equal(current.dirty, false);
    scratch = superIndex + 1;
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "superkey_put", index: scratch, name: "Scratch SK", actions: [4, 1, 1, 1, 1] }],
    });
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "superkey_put", index: scratch, name: "Updated SK", actions: [5, 1, 1, 1, 1] }],
    });
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "superkey_delete", index: scratch }],
    });
    current = await call("save_to_keyboard", { expectedRevision: current.revision, confirm: true });
    await call("open_editor", { editor: "macros" });
    current = await waitDraft("macros");
    const referenced = await client.callTool({
      name: "edit_draft",
      arguments: { expectedRevision: current.revision, edits: [{ kind: "macro_delete", index: macroIndex }] },
    });
    assert.equal(referenced.isError, true);
    await call("open_editor", { editor: "layout" });
    current = await waitDraft("layout");
    assert.equal(current.macros[macroIndex].name, "MCP smoke");
    assert.equal(current.superkeys[superIndex].name, "MCP super");
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "action", layer: 0, key: 0, actionId: `keycode:${53980 + superIndex}` }],
    });
    await call("discard_draft", { expectedRevision: current.revision });
    const backup = await call("export_backup", { includePrivate: true });
    assert.equal(backup.privateContentIncluded, true);
    current = await call("read_draft");
    current = await call("import_backup", { expectedRevision: current.revision, backup: backup.backup });
    assert.equal(current.dirty, true);
    await call("discard_draft", { expectedRevision: current.revision });
    await call("open_editor", { editor: "preferences" });
    current = await waitDraft("preferences");
    assert.ok(current.settingSpecs.ledBrightness);
    current = await call("edit_draft", {
      expectedRevision: current.revision,
      edits: [{ kind: "setting", name: "ledBrightness", value: 120 }],
    });
    assert.equal(current.settings.ledBrightness, 120);
    current = await call("save_to_keyboard", { expectedRevision: current.revision, confirm: true });
    assert.equal(current.dirty, false);
    assert.equal(
      (await call("list_devices")).devices.some(device => device.type === "virtual"),
      true,
    );
    const status = await call("read_device_status");
    assert.equal(typeof status.values["layer.state"], "string");
    await call("open_editor", { editor: "layout" });
    current = await waitDraft("layout");
    const comparison = await call("compare_backup", { expectedRevision: current.revision, backup: backup.backup });
    assert.equal(comparison.valid, true);
    const inventory = await call("list_devices");
    const recoveryResult = await call("restore_backup", {
      expectedRevision: current.revision,
      deviceId: inventory.connected,
      confirm: true,
      backup: backup.backup,
    });
    assert.equal(recoveryResult.target, "virtual_file");
    current = await waitDraft("layout");
    await call("open_editor", { editor: "preferences" });
    current = await waitDraft("preferences");
    const originalBrightness = Number(backup.backup.backup.find(entry => entry.command === "led.brightness").data);
    assert.equal(current.settings.ledBrightness, originalBrightness);
    const appSettings = await call("read_application_settings");
    await call("set_application_setting", { name: "theme", value: "light" });
    await waitDraft("layout");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("light")), true);
    await call("set_application_setting", { name: "theme", value: appSettings.theme });
    await waitDraft("layout");
    await page.getByRole("button", { name: "Disable MCP and disconnect clients" }).click();
    const disabled = await client.callTool({ name: "read_draft", arguments: {} });
    assert.equal(disabled.isError, true);
    console.log(
      "PASS: shared UI draft, manual key edit, action catalog, layer/palette edits, diff/discard, guarded navigation, macro/Superkey CRUD and virtual saves, private macro reads, backup import/export, preferences save, telemetry, full virtual restore, application theme, device inventory and disable.",
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
