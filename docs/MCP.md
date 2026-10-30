# Local MCP control

This first implementation shares the running Layout Editor's draft. It supports
standard key assignments and assigning existing palette slots to LEDs. It does
not yet expose every Bazecor function. See the coverage table below.

## Connect

1. Launch **Bazecor MCP**, connect a device (or load a virtual keyboard), and open
   **Layout Editor**. Quit any other Bazecor instance holding that device.
2. Click **Enable local MCP** above the editor. MCP is off by default each launch.
   The panel shows active requests and the most recent operation. **Disable MCP
   and disconnect clients** closes the listener and invalidates its token.
3. Configure your MCP client to launch the companion with Node.js 22 or newer:

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

Download `Bazecor-MCP-companion.tar.gz` from the same release and extract it if
you do not have a checkout of the repository. Point the client configuration at
the extracted `mcp/companion.cjs`. Node.js must be installed separately.

The companion and `contract.cjs` are also bundled under `resources/mcp` in the
packaged application. Keep them together if copying them out of an extracted
AppImage. The companion is a separate Node process, not an Electron executable.
It never launches the application, connects a device, or opens USB/serial itself.

Linux is the tested platform. The Unix socket code can run on macOS but has not
been verified there. Windows is explicitly rejected until named-pipe ACL handling
is implemented. Socket discovery and a random 256-bit token live in the owner's
`~/.bazecor-mcp/` directory (0700). The socket and credentials have mode 0600;
credential ownership and permissions are checked by the companion. The token
rotates when MCP is re-enabled. There is no network listener. Another live app
instance cannot replace the published endpoint; disable its MCP listener first.

## Tools

| Tool               | Arguments                           | Result                                                                                                                   |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `read_draft`       | none                                | Device identity, connection, virtual flag, selection, key codes, color map, RGB palette, dirty state and opaque revision |
| `edit_draft`       | `expectedRevision`, `edits`         | Validated atomic staged batch and new draft/revision                                                                     |
| `undo_draft`       | `expectedRevision`                  | Restores one prior draft edit, including manual edits, within this editor session                                        |
| `export_draft`     | none                                | Layout-only snapshot including unsaved edits; no file writes or private macro text                                       |
| `save_to_keyboard` | `expectedRevision`, `confirm: true` | Explicit hardware save after a recovery backup; failure retains the draft                                                |

Read `bazecor://contract` for the discoverable contract, or list tools for their
JSON Schemas and MCP annotations. Read and export are read-only. Draft operations
are reversible writes; hardware save is marked destructive. All tools are local.

A key edit is `{ "kind": "key", "layer": 0, "key": 3, "keyCode": 4 }`.
Here `layer` is a **custom-layer index**, not the displayed layer number when
firmware default layers are visible. Writable codes are 0 (disabled), 65535
(transparent), and standard HID keyboard usage IDs 4 through 231. Reserved or
unsupported device usages may have no effect; layer routes, modifiers encoded as
composite actions, macros and Superkeys cannot be assigned through this slice.
Existing special key codes are returned unchanged by reads.

A color edit is `{ "kind": "color", "layer": 0, "led": 2, "palette": 1 }`.
The layer is a color-map index, and `led` is an LED index, **not a physical key
index**. Palette slots and lengths come from the live draft. This assigns an
existing RGB palette entry; Bazecor's existing RGBW conversion runs when saving.

Every mutation requires the revision from a fresh read. Revisions also change
when a person edits the UI or changes selection. A stale revision fails without
applying any edits. Batches contain 1 to 256 edits and are fully preflighted before
state setters run. Undo retains at most 32 prior content states and resets when
the device changes, the draft becomes clean, or the editor unmounts. There is no
persistent undo across restarts. Use repeated undo to discard this session's
changes. Navigating away from the editor makes MCP requests fail promptly.

Save reuses the Layout Editor handler and the existing application connection,
serializers, palette conversion and protocol queue. It reads a fresh recovery
backup before writing, bypasses write caches, and treats returned error objects
and disconnections as failures. A partial write can leave hardware partly
updated; inspect the UI and recovery backup rather than retrying automatically.
Disabling MCP cannot undo hardware commands already sent. Virtual devices are
supported for draft testing; MCP hardware save explicitly rejects virtual devices.
Recovery uses Bazecor's existing backup format and configured backup folder.
The exported layout snapshot is **not** a full recovery backup or an import format.

## Architecture and upstream boundaries

The authoritative draft is the existing `LayoutEditor.tsx` React state. An
additive hook observes committed state and uses existing state setters and
`KeymapDB.parse` to apply edits. Observation copies support revisions and undo;
there is no detached editable JSON store. The normal key picker shares the hook's
state application path. Other existing UI handlers remain intact and their
committed changes invalidate stale MCP revisions.

- `src/mcp/domain.ts`: schemas, atomic preflight, revision/undo history and save
  sequencing, independent of Electron and the keyboard transport.
- `src/mcp/useLiveEditor.tsx`: typed React adapter, IPC handler and opt-in panel.
- `src/mcp/server.ts`: authenticated Unix socket, bounded serialized forwarding,
  trusted-window IPC checks and disconnect handling in Electron main.
- `mcp/`: standalone stdio protocol adapter and discoverable public contract.

The pre-existing main renderer has Node integration and context isolation turned
off. This patch does not change those settings or add eval/raw IPC tools. Migrating
the entire existing renderer to context isolation is separate upstream work; do
not describe this application as an isolated-renderer security boundary.

## Coverage and limits of this slice

| Area                                           | Coverage                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Device selection/connection                    | Read the device currently open in Layout Editor; select/connect/disconnect through existing UI          |
| Editor context                                 | Selected layer, one selected physical key/LED, dirty state and revision                                 |
| Layer content                                  | Read custom layers; standard key edits; firmware defaults are counted but not exported                  |
| Special actions and layer routes               | Existing numeric codes readable; assignment excluded pending semantic capability and routing validation |
| Colors                                         | Read palette and colormap; assign existing palette slots per LED; existing RGBW save serializer reused  |
| Undo and batches                               | Shared UI draft, atomic preflight, stale-revision protection and bounded undo history                   |
| Export                                         | Layout-only in-memory snapshot; full backups still use UI                                               |
| Save                                           | Explicit hardware save, pre-write recovery backup, existing transport and failure reporting             |
| Macros and Superkeys                           | Excluded pending dedicated shared command paths, reference validation and private-text handling         |
| Timing, mouse, LED/sleep and wireless settings | Existing UI only; these views have separate state and live-write paths                                  |
| Firmware, factory reset, pairing reset         | Deliberately excluded; no raw hardware command tool                                                     |

## Verification

Automated tests cover bidirectional React draft changes, atomic batch failure,
revision conflicts, multiple undo operations, index/palette validation, socket
permissions and authentication, rejected commands, disabling MCP, backup failure,
protocol failure and disconnect during save. `yarn test:mcp-live` runs the packaged Linux virtual-keyboard smoke test using
the official MCP SDK over stdio, including an actual manual key-picker edit.
The CI pipeline runs this under Xvfb after packaging. Hardware save is exercised with
mocked write functions only; no real keyboard configuration is written for tests.
