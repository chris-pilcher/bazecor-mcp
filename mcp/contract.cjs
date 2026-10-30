// GPL-3.0-only. Public contract kept independent of Electron and hardware code.
const guide = `Attach to the running Bazecor MCP Layout Editor. MCP is opt-in in the editor.
Read before editing. Revisions are opaque session tokens and include UI changes and selection.
A key edit's layer is the zero-based CUSTOM layer index, independent of the displayed layer number.
A color edit's layer is the zero-based color-map layer index. key is a physical key index; led is a separate LED index.
Only standard HID keyboard usage IDs are writable in this slice: 0 disabled, 65535 transparent, 4 through 231 standard keyboard usages (device-specific support may vary). Existing special actions are returned as raw codes but cannot be assigned through MCP yet.
Colors assign EXISTING palette slots; RGB/RGBW encoding remains in Bazecor's existing save path.
Batch edits are preflighted atomically and staged in the UI. Undo restores the previous draft edit, including manual edits, within the current editor session. Export returns a layout-only snapshot, not a full hardware recovery backup.
Save requires expectedRevision and confirm:true, creates a recovery backup before hardware writes, and uses the application's existing connection and serializers. Failure retains the draft and may leave hardware partially updated. No automatic save retry.
MCP never opens a serial connection or starts another app. Open/select the desired device manually. This slice excludes macros, Superkeys, settings, layer routes, firmware flashing, factory reset and pairing reset. No raw commands, eval, arbitrary paths or shell tools are exposed.`;
const integer = { type: "integer", minimum: 0 };
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const revision = { type: "string", description: "Opaque revision returned by read_draft" };
const edits = {
  type: "array",
  minItems: 1,
  maxItems: 256,
  items: {
    oneOf: [
      object({
        kind: { const: "key" },
        layer: integer,
        key: integer,
        keyCode: { anyOf: [{ enum: [0, 65535] }, { type: "integer", minimum: 4, maximum: 231 }] },
      }),
      object({ kind: { const: "color" }, layer: integer, led: integer, palette: integer }),
    ],
  },
};
const make = (name, operation, description, inputSchema, readOnlyHint, destructiveHint) => ({
  name,
  operation,
  description,
  inputSchema,
  annotations: { readOnlyHint, destructiveHint, idempotentHint: readOnlyHint, openWorldHint: false },
});
const tools = [
  make(
    "read_draft",
    "read",
    "Read connected device, selection, palette, key codes, color map, dirty state and revision from the live UI.",
    object({}),
    true,
    false,
  ),
  make(
    "edit_draft",
    "batch",
    "Atomically stage standard key assignments or existing palette-slot assignments in the live editor.",
    object({ expectedRevision: revision, edits }),
    false,
    false,
  ),
  make(
    "undo_draft",
    "undo",
    "Undo one draft edit in the current editor session. No hardware writes.",
    object({ expectedRevision: revision }),
    false,
    false,
  ),
  make(
    "export_draft",
    "export",
    "Export a layout-only snapshot in the tool response, including staged changes. No filesystem access or private macro text.",
    object({}),
    true,
    false,
  ),
  make(
    "save_to_keyboard",
    "save",
    "Explicitly write the current draft to hardware after a recovery backup. No retries; inspect state after failures.",
    object({ expectedRevision: revision, confirm: { const: true, type: "boolean" } }),
    false,
    true,
  ),
];
module.exports = { tools, guide };
