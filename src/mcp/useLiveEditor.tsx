import React, { useLayoutEffect, useEffect, useRef, useState } from "react";
import { ipcRenderer } from "electron";
import { Command, commandSchema, Draft, DraftSession, preflight, validateDraft } from "./domain";

interface Adapter {
  draft: Draft;
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
      if (command.operation === "read") return current;
      if (command.operation === "export")
        return {
          format: "bazecor-mcp-layout-draft-v1",
          draft: current,
          note: "Layout snapshot only, not a full hardware recovery backup. No macro text included.",
        };
      session.current.check(command.expectedRevision);
      if (!current.connected) throw new Error("Device disconnected");
      if (command.operation === "batch") await apply(preflight(current, command.edits));
      if (command.operation === "undo") await apply(session.current.undo());
      if (command.operation === "save") {
        validateDraft(current);
        if (current.virtual)
          throw new Error(
            "MCP hardware save is disabled for virtual devices. Use draft edits and undo to test; save is verified with mocked transport.",
          );
        const result = await latest.current.save(() => session.current.check(command.expectedRevision));
        if (!result.success)
          throw new Error(result.error || "Save failed. Draft retained; hardware may have been partially updated.");
        await commitAfter(() => refresh(value => value + 1));
      }
      return { ...session.current.read(), validation: { valid: true }, operation: command.operation };
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
