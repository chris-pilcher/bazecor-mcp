// GPL-3.0-only. Schemas are generated from the app validators; no Electron dependency.
const schemas = require("./schemas.json");
const guide = `Local MCP control for the running Bazecor fork. Enable MCP in the app.
HARDWARE WRITES: approving save_to_keyboard or restore_backup permits writes to the connected keyboard. Only enable/allow this MCP tool if you are comfortable granting that access. Prefer per-call client approval. Recovery backups do not replace approval.
Use list_devices and open_editor to work in the app's current UI. Navigation/device changes reject dirty drafts. Read the new view after loading; each view has its own opaque revision token.
read_draft returns private macro action counts, not action sequences, by default. includePrivate:true explicitly requests those sequences. Mutations and diffs redact macro actions in responses.
Read before editing. edit_draft preflights an atomic batch. Key/action layers are custom-layer indices; selection reports the displayed layer. LED indices are independent of physical key indices. list_actions exposes validated action IDs and labels for the connected device. decode_actions never treats an unknown raw code as supported.
Layout edits include key/action, palette, color/color_bulk, layer_name, layer_copy, layer_reset and selection. Explicit firmware_default reset requires a defaultLayer index; inheritance is never inferred. Macros and Superkeys have put/delete edits in their respective editors. Macro action wire types: 1 interval pair, 2 wait, 3/4/5 function-key press/release/tap, 6/7/8 HID key press/release/tap. Superkeys have five gesture codes; 1 is an empty gesture. Referenced definitions cannot be deleted implicitly; shifted references are remapped. Cycles and invalid layer routes are rejected.
Preferences edits use kind:setting, name and value. read_draft.settingSpecs lists only observed/advertised settings with their exact units and bounds; do not guess setting names. Settings are staged until explicit save.
Undo/discard/diff refer to the current editor session. save_to_keyboard validates again, creates recovery before writes, and uses the existing application connection and serializers. On virtual keyboards it saves the virtual file chosen in the UI. Failed hardware writes may be partial; read state and use recovery rather than retrying automatically.
No raw commands, eval, arbitrary paths, firmware flashing, factory reset or pairing reset are exposed. Windows IPC is not implemented. See docs/MCP.md for coverage and tested limitations.`;
const make = (name, operation, description, readOnlyHint, destructiveHint = false) => ({
  name,
  operation,
  description,
  inputSchema: schemas[operation],
  annotations: { readOnlyHint, destructiveHint, idempotentHint: readOnlyHint, openWorldHint: false },
});
const tools = [
  make(
    "read_draft",
    "read",
    "Read the active editor's shared draft, revision, selection, capabilities and setting schemas. Macro sequences require includePrivate:true.",
    true,
  ),
  make(
    "edit_draft",
    "batch",
    "Atomically stage validated edits in the current UI draft. Does not write hardware.",
    false,
  ),
  make("undo_draft", "undo", "Undo one edit in this editor session.", false),
  make("discard_draft", "discard", "Restore this editor session's clean baseline without hardware writes.", false),
  make(
    "diff_draft",
    "diff",
    "Compare the draft with its clean baseline. Private macro sequences are redacted unless requested.",
    true,
  ),
  make(
    "export_draft",
    "export",
    "Return the current editor snapshot, including staged changes. Macro sequences require includePrivate:true.",
    true,
  ),
  make(
    "list_actions",
    "catalog",
    "Discover supported semantic action IDs, labels and parameters, with pagination and search.",
    true,
  ),
  make(
    "decode_actions",
    "decode",
    "Decode raw key codes against the connected device's available action catalog.",
    true,
  ),
  make(
    "list_devices",
    "devices",
    "Read the application's device inventory without probing active serial connections.",
    true,
  ),
  make(
    "open_editor",
    "navigate",
    "Switch the app to Layout, Macros, Superkeys, Preferences or Device Manager. Refuses to leave a dirty draft.",
    false,
  ),
  make(
    "connect_device",
    "connect",
    "Explicitly connect one unambiguous device from the application's inventory. Disconnect an existing device first.",
    false,
  ),
  make(
    "disconnect_device",
    "disconnect",
    "Disconnect the active device through the normal application path. Refuses dirty drafts.",
    false,
  ),
  make(
    "export_backup",
    "backup_read",
    "Read saved device configuration as a Bazecor backup. Macro sequences require includePrivate:true; redacted backups cannot fully restore macros.",
    true,
  ),
  make(
    "create_recovery_backup",
    "backup_store",
    "Store a complete recovery backup in the app-configured folder. Does not write the keyboard; contains private macro data on disk. Requires confirm:true.",
    false,
  ),
  make(
    "import_backup",
    "backup_import",
    "Validate a same-device-type Bazecor backup and stage supported fields in the active editor. Returns ignored commands. Never executes arbitrary commands from a backup.",
    false,
  ),
  make(
    "restore_backup",
    "restore_backup",
    "HARDWARE WRITE: restore validated same-device-type configuration from a complete backup. Only approve if comfortable allowing this MCP tool to write hardware. Requires current clean revision, active device ID, confirm:true; creates recovery first. Unknown/firmware/reset/pairing commands are never executed.",
    false,
    true,
  ),
  make(
    "compare_backup",
    "backup_compare",
    "Validate and compare supported backup fields against the active editor without changing the draft or hardware. Macro sequences are redacted in the diff.",
    true,
  ),
  make(
    "read_device_status",
    "telemetry",
    "Read advertised firmware, identity, battery and active-layer status through the existing connection. Never probes a second serial port.",
    true,
  ),
  make(
    "read_application_settings",
    "app_settings",
    "Read app theme, language choices, display preferences and Layer Lens options.",
    true,
  ),
  make(
    "set_application_setting",
    "app_setting",
    "Immediately apply one whitelisted app setting: theme, language, deviceNickname, verbose, showDefaults, runInBackground or lens.*. No keyboard write; refuses dirty drafts.",
    false,
  ),
  make(
    "convert_backup",
    "backup_convert",
    "Read-only explicit backup conversion using upstream's supported Raise/Raise2 or Defy-to-Sonsei converter. Returns supplied private macro data, so includePrivate:true is required. Does not write hardware.",
    true,
  ),
  make(
    "save_to_keyboard",
    "save",
    "HARDWARE WRITE: approve only if comfortable allowing this MCP tool to write the keyboard's stored configuration. Requires confirm:true and expectedRevision. Recovery backup precedes writes. Virtual devices save their UI-selected file.",
    false,
    true,
  ),
];
module.exports = { tools, guide, schemas };
