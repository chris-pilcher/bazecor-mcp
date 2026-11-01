# Local MCP control

This personal fork exposes the running application's configuration through MCP.
The agent and human use the same React drafts and existing device connection.
Linux x86-64 AppImage is the tested distribution.

## Edit visibly, then save yourself

Ask the agent to use `read_draft`, `list_actions` and `edit_draft`. Draft edits
update the open Bazecor editor immediately, including keys, layer names, palette
and LED colors. No JSON export or import is required. Use `selection` edits to
show the layer being changed. Review the result in the app, then click its Save
to device button yourself. Tell the agent to leave hardware saves to you.

Layout also accepts `superkey_put`, allowing a new definition and its key
assignments in the same atomic batch. The Layout Editor previews its name and
saves changed Superkey definitions before the keymap when you click Save. Macro
edits and definition deletion use their respective editors. Navigation refuses
to discard an unsaved draft.

If `edit_draft` is missing from your agent's tools, check its MCP tool filters and
reconnect the client using the matching release companion. The companion exposes
this tool in `tools/list`; backup files are not a substitute for live editing.

After updating the companion or generated schemas, restart the client-side MCP
server so its Node process reloads the contract, then refresh tool discovery.
Keyboard reconnect and Bazecor restart do not reload a running companion. Codex
may omit an individual tool when its schema conversion fails; inspect
`codex_core::mcp_tool_exposure` warnings for `Skipping MCP tool`. Version 0.2.1
uses homogeneous array schemas for macro interval pairs, with exactly two values,
to avoid legacy tuple-schema conversion failures. `list_devices.mcpVersion`
identifies the app's MCP implementation separately from upstream `appVersion`.

An empty `commands` list means advertised capabilities are unavailable, not that
the keyboard has no configuration. `commandDiscovery` reports this explicitly.
Version 0.2.1 preserves firmware help when the Layout Editor loads its language
keymap. It can also reuse cached firmware help from older editor sessions. It
does not infer writable commands from existing key codes or bypass capability
checks. Active layer is only known when firmware advertises a layer query.

Recovery responses distinguish the redacted returned backup (`restorable`) from
the complete local recovery file (`storedPath`, `storedBackupRestorable`, and
`storedBackupIncludesPrivate`). A redacted response does not mean the stored
recovery file lost its macros.

## Hardware-write permission

**Approving the MCP tools `save_to_keyboard` or `restore_backup` permits writes to
your connected keyboard's stored configuration.** These tools can change actual
keyboard behavior. **Only enable this connection and allow hardware-write tools
if you are comfortable giving the connected agent that access.** Prefer per-call
approval in your MCP client if you want to review each write. `confirm:true` is an
explicit tool argument, not a substitute for your client's approval policy.
Recovery backups help recover from mistakes; they do not make writes read-only.

Draft editing, undo, discard, comparison and conversion do not write the keyboard.
Application settings apply immediately to the app. Device connect/disconnect
changes the live connection. Creating a recovery backup writes a file in the
app-configured backup directory. The tool annotations distinguish these actions.

## Connect

1. Quit an older Bazecor instance holding the keyboard. Launch **Bazecor MCP**.
2. Click **Enable local MCP** in the app. It is disabled at each launch. The panel
   shows activity and offers **Disable MCP and disconnect clients**.
3. Configure your client to run the companion with Node.js 22 or newer:

```json
{
  "mcpServers": {
    "bazecor": {
      "command": "node",
      "args": ["/absolute/path/to/bazecor-mcp/mcp/companion.cjs"]
    }
  }
}
```

If you do not have a checkout, download `Bazecor-MCP-companion.tar.gz` alongside
the AppImage, extract it, and point the client at the extracted
`mcp/companion.cjs`. Keep `contract.cjs` and `schemas.json` alongside it. The
companion is also bundled under the packaged application's `resources/mcp`.
Node.js must be installed separately. The companion never launches Electron or
opens another USB/serial connection.

Use `list_devices`, `connect_device`, and `open_editor` to operate the existing
app. Device IDs come from the inventory. Discovery reuses the app's inventory;
open Device Manager for its normal scan rather than probing an active port again.
Wait for a newly opened view to load, then read its draft. A dirty draft blocks
navigation, device changes, app-setting changes and full backup restore.

## Tool groups

| Tools                                                  | Purpose and effects                                                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_devices`, `read_device_status`                   | Existing inventory, identity, app/firmware versions, advertised commands, battery and active-layer data where the firmware reports it. Read-only.                                                                     |
| `connect_device`, `disconnect_device`                  | Explicit normal application connection path; `confirm:true` required. No configuration save.                                                                                                                          |
| `open_editor`                                          | Open Layout, Macros, Superkeys, Preferences or Device Manager. Refuses dirty drafts.                                                                                                                                  |
| `read_draft`                                           | Read committed live UI state, current revision, selection, limits and setting schemas. Macro steps are private by default.                                                                                            |
| `list_actions`, `decode_actions`                       | Paginated/searchable semantic action catalog and supported keycode decoding. Unknown codes remain explicitly unsupported.                                                                                             |
| `edit_draft`                                           | Preflight a complete atomic batch and stage it in the current editor. No hardware write.                                                                                                                              |
| `undo_draft`, `discard_draft`, `diff_draft`            | Undo one change, restore the clean session baseline, or inspect a readable diff.                                                                                                                                      |
| `export_draft`                                         | Return an editor snapshot including unsaved changes. This is distinct from a saved-device backup.                                                                                                                     |
| `export_backup`, `create_recovery_backup`              | Read saved hardware configuration, or explicitly store a full backup in the configured backup folder.                                                                                                                 |
| `compare_backup`, `import_backup`                      | Validate/compare against the active editor or stage that editor's supported fields. Return ignored commands; never execute commands from the input.                                                                   |
| `convert_backup`                                       | Explicit read-only use of upstream's Raise-to-Raise2, Raise2-to-Raise or Defy-to-Sonsei converter. Does not restore automatically.                                                                                    |
| `save_to_keyboard`                                     | **Hardware write:** save the current view's validated draft with recovery first. Requires its current revision and `confirm:true`.                                                                                    |
| `restore_backup`                                       | **Hardware write:** preflight and restore supported configuration from a complete same-device-type backup, with recovery first. Requires a clean current revision, the active inventory device ID and `confirm:true`. |
| `read_application_settings`, `set_application_setting` | Read/apply bounded app preferences and Layer Lens settings. Immediate app changes, not keyboard writes.                                                                                                               |

List tools for their generated JSON Schemas and annotations. Resources
`bazecor://contract` and `bazecor://schemas` describe the contract. Device setting
schemas and limits are returned by `read_draft`; they depend on the active view
and actual advertised firmware commands.

## Editing workflow

Every draft mutation requires the opaque `expectedRevision` from a fresh read.
Manual edits and selection changes also invalidate revisions. An obsolete
revision rejects the operation without overwriting the person's work. A batch
has 1 to 256 edits. Its entire candidate is validated before state setters run.
Results include the new revision and a readable, privacy-filtered diff.

Each editor has its own session and draft, matching the upstream app. Save or
discard before changing view. This integration does not invent an independently
editable global copy. Undo retains up to 32 content changes and resets after
save, device changes or unmount. Discard returns to the session's clean baseline;
it is not a persistent undo history across restarts.

### Layout

A normal key edit is:

```json
{ "kind": "key", "layer": 0, "key": 3, "keyCode": 4 }
```

Prefer discoverable actions for shortcuts, layer routes, media/system keys, mouse
controls, LED functions, wireless shortcuts and Layer Lens:

```json
{ "kind": "action", "layer": 0, "key": 3, "actionId": "keycode:17450" }
```

`list_actions` returns the actual action ID, label, category, numeric code, layer
route and definition reference when applicable. Codes come from the existing
picker tables, gated by device capabilities. Unused leader, steno, space-cadet
and tap-dance tables are not advertised as features. Normal modifier combinations
reuse the existing tables rather than a second encoder. Transparent is **65535**;
disabled is **0**. Layer routes are checked in keys, macros and Superkeys. A
reference to an absent macro, Superkey or layer is rejected.

`layer` for key/action edits is a zero-based **custom-layer index**. Displayed
layer indices can include firmware defaults. Numeric order alone does not imply
firmware inheritance. Supported layer edits are `layer_name`, `layer_copy`,
`layer_reset`, and `selection`. Reset can use `disabled`, `transparent`, or an
explicit `firmware_default` with `defaultLayer`. No default source is guessed.
Layer names now share draft/save/undo semantics instead of persisting immediately.

For persistent OS or base-mode switching, distinguish a layer lock (toggle one
layer on/off) from Move to layer (replace the active layer stack). A transparent
base overlay needs its underlying base to remain active; do not combine it with
a Move action that removes that base. For explicit switches in each direction,
make both bases complete first, then use the appropriate Move action in each
mode's function layer. Read back the staged routes and test the physical keys
after the human saves. Draft validation checks references and supported actions;
it does not prove firmware key-press behavior or layer priority.

Colors support `palette`, `color`, `color_bulk`, and `color_side`. Palette edits
specify integer RGB channels 0 to 255. Slot counts come from the live palette.
`color_side` accepts `left`, `right` or `both` and `keys`, `underglow` or `all`.
It uses the device's LED arrays, including non-contiguous indices. Physical key
indices and LED indices are separate. RGBW conversion uses the same serializer as
the normal UI save path.

### Macros and Superkeys

Open the corresponding editor. `macro_put` creates at the next index or updates
an existing index, with a name and typed `actions`. Wire action types match the
existing serializer:

| Type    | Meaning                          | `keyCode` data                 |
| ------- | -------------------------------- | ------------------------------ |
| 1       | Interval                         | Two 16-bit timing values       |
| 2       | Wait                             | One 16-bit timing value        |
| 3, 4, 5 | Function-key press, release, tap | A validated 16-bit action code |
| 6, 7, 8 | HID key press, release, tap      | An 8-bit keyboard usage        |

Unsupported opcodes and malformed/truncated streams fail explicitly. Interval
payloads and zero bytes round-trip without being mistaken for terminators.
Serialized macro size is checked against the device-reported memory capacity.
The per-macro action limit follows the UI's device limit.

`superkey_put` creates/updates a definition with five gesture codes in the same
order as the UI. Use **1** for an empty gesture; **0** is the wire terminator.
The UI's 70-definition cap applies. Nested Superkeys and cycles spanning macros
and Superkeys are rejected.

`macro_delete` and `superkey_delete` reject referenced definitions. Remove or
replace references explicitly first. Deleting an unused definition remaps higher
indices and updates affected layout, macro and Superkey references through the
existing serializers. IDs are positional, and revisions protect against stale
indices. Names persist after an explicit save.

`read_draft` and `export_draft` omit macro sequences unless
`includePrivate:true` is requested. Mutation responses and ordinary diffs never
return private macro steps. `diff_draft` can include them when explicitly
requested. Backup export similarly requires `includePrivate:true` for a complete
restorable macro map. Stored recovery files necessarily contain the full data.

### Keyboard preferences and app settings

In Preferences, `kind:"setting"` edits only names present in `settingSpecs`.
The schema reports the underlying command, type, raw units and bounds. Examples
include brightness, LED idle/sleep times, mouse speed/acceleration/wheel limits,
dual-function timing, Superkey timing, default layer and layer mode. Wireless
settings include supported battery-saving, Bluetooth device name, RF power and
channel hopping, wireless brightness, fading and sleep behavior. Unsupported or
unobserved fields are omitted. Existing wire sentinels, where needed, appear as
`specialValues`. This does not expose pairing reset.

The app-level tool accepts theme, keyboard language, device nickname, verbose
logging, default-layer display, background mode and bounded `lens.*` options.
Language choices come from the existing language database. Lens writes require
the actual capability flag and use the app's existing IPC handlers. These changes
apply immediately and refresh the view, so dirty drafts are rejected first.

## Save and recovery

All editor saves share a device write gate and the application's existing
transport. Recovery is read fresh and stored before hardware writes begin. A
backup-storage failure prevents writes. An error object or missing protocol
acknowledgement is a failure, not success. Failed saves keep the draft dirty and
invalidate transport caches. UI saves and MCP saves use this same path.

The full restore tool validates model/type, dimensions, palette references,
integer wire data, action support, layer routes, definition references/cycles,
memory and setting ranges before writing. It uses only a fixed configuration
allowlist and the shared serializers. Unknown commands are reported as ignored;
firmware, EEPROM operations, factory reset and pairing reset are never forwarded.
Cross-device conversion is separate and explicit. After restoration the editor
reloads saved device state.

Protocol failures can leave a partially updated keyboard. A pre-write recovery
backup remains available; the tool never claims a full successful restore or
retries automatically. Disabling MCP cannot revoke hardware commands already
sent. Real hardware writes require a concrete requested change for verification.

On a virtual device, explicit saves and restores write only the virtual file
chosen through the normal UI. The smoke test uses a disposable file and temporary
profile, not a physical keyboard. `export_backup` works there too; creating an
additional on-disk recovery file for a virtual device remains a UI/file workflow.

## Local IPC and multiple instances

The Unix socket and rotating 256-bit token are in `~/.bazecor-mcp/` by default.
The directory is owner-only (0700); socket and credentials are 0600. The
companion checks credential ownership and permissions. There is no network
listener. Enabling one default endpoint refuses to replace another live app's
endpoint. The existing app instance lock also remains in place.

For deliberately separate profiles, set `BAZECOR_MCP_RUNTIME_DIR` to the same
absolute, dedicated directory for both the app and its companion. The same owner
and permission checks apply. Automated smoke tests use this option so they do not
take over a user's active MCP endpoint.

Linux is tested. Unix IPC can run on macOS but has not been validated there.
Windows is explicitly rejected until named-pipe ACL handling is implemented.
The pre-existing main renderer still has Node integration and context isolation
turned off. This patch does not change those settings and does not expose an
eval, shell, raw IPC or raw hardware-command tool. Migrating upstream's entire
renderer to context isolation remains separate work.

## Coverage and deliberate exclusions

| UI area                          | Practical MCP coverage                                                                                                           | Remaining/excluded                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Devices                          | Inventory, identity, versions, telemetry, explicit connect/disconnect                                                            | Discovery remains the app's existing scan; no independent active-port probes                                                          |
| Layout/selection                 | Live custom/default content, current selection, names, copy/reset, action catalog, decoding, shortcuts, all UI action categories | Layer reorder is not supported by this upstream UI; no invented inheritance semantics                                                 |
| Macros                           | Typed sequences, inspect/create/update/delete, naming, limits, safe references, shared save                                      | Firmware opcodes the UI does not support are rejected, not guessed                                                                    |
| Superkeys                        | Five gestures, inspect/create/update/delete, names, references and timing                                                        | Nested Superkeys and recursive definitions are rejected                                                                               |
| Colors                           | RGB/RGBW, palette slots, per-LED/selection/side/layer edits, brightness and supported sleep settings                             | No assumed fixed color names or key-to-LED identity                                                                                   |
| Keyboard/wireless settings       | Supported observed UI fields with device-aware schemas                                                                           | Pairing reset and firmware-specific unadvertised commands excluded                                                                    |
| Backups                          | Full export, controlled storage, comparison, per-view staging, explicit supported conversion and full configuration restore      | Unknown/unsafe commands are ignored; conversion hardware combinations need separate verification                                      |
| App/Layer Lens                   | Theme, language, nickname, logging/display/background and bounded Lens options                                                   | Arbitrary paths, backup deletion/retention administration, developer tools, OS access installation and update management stay UI-only |
| Firmware/destructive maintenance | None                                                                                                                             | Firmware flashing, factory reset and pairing reset are deliberately excluded                                                          |
| PDF export                       | None                                                                                                                             | Upstream itself marks it unimplemented                                                                                                |
| Other OS distributions           | Existing local build targets                                                                                                     | This release tests Linux; macOS and Windows need platform-specific verification                                                       |

## Maintenance and verification

MCP code stays in `src/mcp/`, `mcp/`, and the smoke/schema scripts. Small adapters
connect the existing views; there is no second authoritative configuration or
serial transport. Schemas are generated from the runtime Zod validators with
`yarn mcp:schemas`; `yarn test:mcp-contract` rejects stale companion schemas.
See [upstream update guidance](UPSTREAM.md) for integration points and checks.

Unit tests cover shared state, revision conflicts, atomic batches, undo/discard,
privacy, routing, definition deletion/remapping/cycles, macro/Superkey and RGBW
round trips, settings bounds, app allowlists, write-gate concurrency,
authentication/permissions and backup/transport failures. The official MCP SDK
smoke test runs against the packaged app and exercises manual UI edits, macros,
Superkeys, virtual saves, preferences, backup staging/full restore, telemetry and
app theme changes. CI runs it under Xvfb. Physical keyboard configuration writes
are not performed as a demonstration.
