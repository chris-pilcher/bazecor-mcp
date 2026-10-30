import React, { useLayoutEffect, useEffect, useRef, useState } from "react";
import { ipcRenderer } from "electron";
import { ActionDescriptor, assertAction } from "./actions";
import { publicDraft, draftDiff } from "./diff";
import { validateDefinitions } from "./definitions";
import { Command, commandSchema, Draft, DraftSession, preflight, validateDraft } from "./domain";

interface Adapter {
  draft: Draft;
  catalog?: ActionDescriptor[];
  validate?: (draft: Draft) => void;
  importBackup?: (backup: unknown, draft: Draft) => { draft: Draft; ignoredCommands: string[] };
  ready: boolean;
  saving: boolean;
  apply: (draft: Draft) => void;
  save: (assertUnchanged: () => void) => Promise<{ success: boolean; error?: string }>;
}
export function useLiveEditor(adapter: Adapter) {
  const session = useRef(new DraftSession());
  const latest = useRef(adapter);
  const commit = useRef<(() => void) | undefined>();
  const busy = useRef(false);
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    latest.current = adapter;
    if (adapter.ready) session.current.observe(adapter.draft);
    commit.current?.();
    commit.current = undefined;
  });
  const commitAfter = async (action: () => void) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        commit.current = undefined;
        reject(new Error("Editor did not commit the change. Read the draft before retrying."));
      }, 5000);
      commit.current = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        action();
      } catch (error) {
        clearTimeout(timer);
        commit.current = undefined;
        reject(error);
      }
    });
  };
  const apply = (draft: Draft) => commitAfter(() => latest.current.apply(draft));
  const execute = async (input: unknown) => {
    const command = commandSchema.parse(input);
    if (!latest.current.ready) throw new Error("Wait for the connected device's Layout Editor to finish loading.");
    if (busy.current || latest.current.saving)
      throw new Error("Editor is busy. Re-read after the current operation completes.");
    busy.current = true;
    try {
      const current = session.current.read();
      if (command.operation === "read")
        return { ...publicDraft(current, command.includePrivate), revision: current.revision };
      if (command.operation === "catalog") {
        const entries = (latest.current.catalog || []).filter(
          action =>
            !command.query ||
            `${action.category} ${action.label} ${action.id}`.toLowerCase().includes(command.query.toLowerCase()),
        );
        const cursor = command.cursor || 0;
        const limit = command.limit || 100;
        return {
          actions: entries.slice(cursor, cursor + limit),
          total: entries.length,
          nextCursor: cursor + limit < entries.length ? cursor + limit : null,
        };
      }
      if (command.operation === "decode")
        return {
          actions: command.codes.map(
            code => (latest.current.catalog || []).find(action => action.code === code) || { code, supported: false },
          ),
        };
      if (command.operation === "diff")
        return draftDiff(session.current.baselineDraft() || current, current, command.includePrivate);
      if (["devices", "connect", "disconnect", "navigate", "backup_read", "backup_store"].includes(command.operation))
        throw new Error("Application command routed to the wrong handler");
      if (command.operation === "export")
        return {
          format: "bazecor-mcp-layout-draft-v1",
          draft: publicDraft(current, command.includePrivate),
          note: "Layout snapshot only, not a full hardware recovery backup. No macro text included.",
        };
      if (!("expectedRevision" in command)) throw new Error("Unsupported editor operation");
      session.current.check(command.expectedRevision);
      if (!current.connected) throw new Error("Device disconnected");
      const { catalog } = latest.current;
      const validateCode = catalog ? (code: number, draft: Draft) => assertAction(code, draft, catalog) : undefined;
      if (command.operation === "batch") {
        const next = preflight(current, command.edits, validateCode);
        latest.current.validate?.(next);
        await apply(next);
      }
      if (command.operation === "backup_import" || command.operation === "backup_compare") {
        if (!latest.current.importBackup) throw new Error("Backup import is unavailable in this view");
        const staged = latest.current.importBackup(command.backup, current);
        validateDraft(staged.draft);
        validateDefinitions(staged.draft, validateCode);
        latest.current.validate?.(staged.draft);
        if (command.operation === "backup_compare")
          return {
            valid: true,
            diff: draftDiff(current, staged.draft),
            ignoredCommands: staged.ignoredCommands,
            note: "No draft or hardware changes were made.",
          };
        await apply(staged.draft);
        const updated = session.current.read();
        return {
          ...publicDraft(updated),
          revision: updated.revision,
          diff: draftDiff(current, updated),
          ignoredCommands: staged.ignoredCommands,
          note: "Only this editor's supported fields were staged; no hardware commands were executed.",
        };
      }
      if (command.operation === "discard") await apply(session.current.discard());
      if (command.operation === "undo") await apply(session.current.undo());
      if (command.operation === "save") {
        validateDraft(current);
        validateDefinitions(current, validateCode);
        latest.current.validate?.(current);
        const result = await latest.current.save(() => session.current.check(command.expectedRevision));
        if (!result.success)
          throw new Error(result.error || "Save failed. Draft retained; hardware may have been partially updated.");
        await commitAfter(() => refresh(value => value + 1));
      }
      const updated = session.current.read();
      return {
        ...publicDraft(updated),
        revision: updated.revision,
        validation: { valid: true },
        operation: command.operation,
        diff: draftDiff(current, updated),
      };
    } finally {
      busy.current = false;
    }
  };
  const handler = useRef(execute);
  useLayoutEffect(() => {
    handler.current = execute;
  });
  useEffect(() => {
    const listener = async (_event: Electron.IpcRendererEvent, message: { id: number; command: Command }) => {
      try {
        ipcRenderer.send("mcp:result", { id: message.id, result: await handler.current(message.command) });
      } catch (error) {
        ipcRenderer.send("mcp:result", { id: message.id, error: (error as Error).message });
      }
    };
    ipcRenderer.on("mcp:command", listener);
    ipcRenderer.send("mcp:editor", true);
    return () => {
      ipcRenderer.send("mcp:editor", false);
      ipcRenderer.removeListener("mcp:command", listener);
    };
  }, []);
  return {
    // The normal key picker shares preflight and state application with MCP.
    editKey: (layer: number, key: number, keyCode: number) => {
      if (busy.current || latest.current.saving) return;
      // Existing UI supports additional firmware actions. Keep its parser authoritative
      // for those while applying through the same draft setter.
      const next = { ...session.current.read(), keys: latest.current.draft.keys.map(row => row.slice()), dirty: true };
      if (!next.keys[layer] || key < 0 || key >= next.keys[layer].length) return;
      next.keys[layer][key] = keyCode;
      latest.current.apply(next);
    },
  };
}

export function McpControl() {
  const [state, setState] = useState({ enabled: false, clients: 0, lastActivity: "", endpoint: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      ipcRenderer
        .invoke("mcp:control")
        .then(result => {
          if (active) setState(result);
        })
        .catch(e => {
          if (active) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="px-3 py-2 text-sm" role="status">
      <button
        type="button"
        onClick={async () => {
          try {
            setState(await ipcRenderer.invoke("mcp:control", !state.enabled));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {state.enabled ? "Disable MCP and disconnect clients" : "Enable local MCP"}
      </button>
      <span className="ml-3">
        {state.enabled ? `MCP enabled: ${state.clients} client(s). ${state.lastActivity}` : "MCP disabled"}
      </span>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
